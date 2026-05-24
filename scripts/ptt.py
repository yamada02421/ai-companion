"""
Push-to-Talk / VAD 双方向会話
- PTT モード (デフォルト): 右Altキーを押している間マイク録音
- VAD モード (--vad): 音声検出で自動録音開始/停止

起動:
  python scripts/ptt.py         # PTT モード
  python scripts/ptt.py --vad   # VAD モード
"""
import sys
import os
import argparse
import tempfile
import wave
import threading
import time as time_module
from pathlib import Path

# Add project root
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import numpy as np
import sounddevice as sd

# --- Config ---
SAMPLE_RATE = 16000
CHANNELS = 1

# --- VAD Config ---
VAD_AGGRESSIVENESS = 2          # 0-3, 2 = balanced
VAD_FRAME_MS = 30               # 30ms per frame
VAD_FRAME_SAMPLES = int(SAMPLE_RATE * VAD_FRAME_MS / 1000)  # 480 samples
VAD_SPEECH_FRAMES = 10          # consecutive voiced frames to start recording
VAD_SILENCE_FRAMES = 30         # consecutive unvoiced frames to stop recording
VAD_MIN_DURATION = 0.5          # minimum recording duration in seconds
VAD_MAX_DURATION = 30.0         # maximum recording duration in seconds

# --- State ---
recording = False
audio_frames = []
whisper_model = None

# --- VAD State ---
vad_paused = False              # True while AI is responding (prevent feedback)
vad_processing = False          # True while transcription/response is in progress


def load_whisper():
    global whisper_model
    if whisper_model is None:
        print("[PTT] Loading Whisper model (first time, may take a moment)...", flush=True)
        from faster_whisper import WhisperModel
        whisper_model = WhisperModel("medium", device="cuda", compute_type="float16")
        print("[PTT] Whisper model loaded!", flush=True)
    return whisper_model


def transcribe(audio_path: str) -> str:
    model = load_whisper()
    segments, _ = model.transcribe(audio_path, language="ja", beam_size=5)
    text = "".join(segment.text for segment in segments).strip()
    return text


def save_wav(frames, path: str):
    audio_data = np.concatenate(frames, axis=0)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes((audio_data * 32767).astype(np.int16).tobytes())


def chat_and_speak(text: str, vad_mode: bool = False):
    """Call the AI companion CLI and let it handle response + voice."""
    global vad_paused
    import subprocess
    cli_path = PROJECT_ROOT / "packages" / "terminal" / "src" / "cli.ts"
    env = os.environ.copy()
    env["COMPANION_CHAR"] = os.environ.get("COMPANION_CHAR", "rei")

    # Pause VAD during AI response to prevent feedback
    if vad_mode:
        vad_paused = True

    try:
        result = subprocess.run(
            ["npx", "tsx", str(cli_path), text],
            capture_output=True, text=True, timeout=60,
            cwd=str(PROJECT_ROOT), env=env,
        )
        if result.stdout.strip():
            print(f"\n[レイ] {result.stdout.strip()}", flush=True)
    finally:
        if vad_mode:
            vad_paused = False


def process_recorded_audio(mode_label: str, ready_msg: str, vad_mode: bool = False):
    """Process recorded audio: save, transcribe, chat, and print ready message."""
    global audio_frames, vad_processing

    if vad_mode:
        vad_processing = True

    try:
        if not audio_frames:
            print(f"[{mode_label}] No audio captured", flush=True)
            return

        frames_copy = list(audio_frames)
        audio_frames = []

        # Save to temp file
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp.close()
        save_wav(frames_copy, tmp.name)

        # Transcribe
        print(f"[{mode_label}] Transcribing...", flush=True)
        text = transcribe(tmp.name)
        os.unlink(tmp.name)

        if not text:
            print(f"[{mode_label}] (No speech detected)", flush=True)
            print(f"\n{ready_msg}", flush=True)
            return

        print(f"[あなた] {text}", flush=True)

        # Chat & speak
        chat_and_speak(text, vad_mode=vad_mode)
        print(f"\n{ready_msg}", flush=True)
    finally:
        if vad_mode:
            vad_processing = False


# =====================================================================
# PTT Mode (Push-to-Talk) — original behavior
# =====================================================================

def audio_callback_ptt(indata, frames, time, status):
    if recording:
        audio_frames.append(indata.copy())


def on_press(key):
    from pynput import keyboard as kb
    global recording, audio_frames
    if key == kb.Key.alt_r and not recording:
        recording = True
        audio_frames = []
        print("[PTT] Recording...", end="", flush=True)


def on_release(key):
    from pynput import keyboard as kb
    global recording
    if key == kb.Key.alt_r and recording:
        recording = False
        print(" Done!", flush=True)
        threading.Thread(
            target=process_recorded_audio,
            args=("PTT", "[PTT] Ready. Hold Right-Alt to talk."),
            daemon=True,
        ).start()


def main_ptt():
    from pynput import keyboard

    print("=" * 50)
    print("  Push-to-Talk: 綾波レイと話そう")
    print("  右Altキーを押している間、話してください")
    print("  Ctrl+C で終了")
    print("=" * 50)
    print()

    load_whisper()

    stream = sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype="float32",
        callback=audio_callback_ptt,
    )
    stream.start()

    print("[PTT] Ready. Hold Right-Alt to talk.\n", flush=True)

    with keyboard.Listener(on_press=on_press, on_release=on_release) as listener:
        try:
            listener.join()
        except KeyboardInterrupt:
            pass

    stream.stop()
    print("\n[PTT] Goodbye!")


# =====================================================================
# VAD Mode (Voice Activity Detection) — hands-free
# =====================================================================

def main_vad():
    import webrtcvad

    vad = webrtcvad.Vad(VAD_AGGRESSIVENESS)

    # Shared state for the VAD loop
    voiced_count = 0           # consecutive voiced frames
    unvoiced_count = 0         # consecutive unvoiced frames
    is_recording = False       # currently recording speech
    record_start_time = 0.0    # when current recording started
    vad_audio_frames = []      # collected audio frames during recording

    # Lock for thread-safe access to the frame buffer
    frame_lock = threading.Lock()
    pending_frames = []        # raw audio frames from the stream callback

    def audio_callback_vad(indata, frames, time_info, status):
        """Collect raw audio data from the microphone."""
        with frame_lock:
            pending_frames.append(indata.copy())

    print("=" * 50)
    print("  VAD Mode: 綾波レイと話そう")
    print("  話しかけてください（自動検出モード）")
    print("  Ctrl+C で終了")
    print("=" * 50)
    print()

    load_whisper()

    stream = sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype="float32",
        blocksize=VAD_FRAME_SAMPLES,
        callback=audio_callback_vad,
    )
    stream.start()

    print("[VAD] Ready. Listening...\n", flush=True)

    try:
        while True:
            # Drain pending frames
            with frame_lock:
                frames_to_process = list(pending_frames)
                pending_frames.clear()

            if not frames_to_process:
                time_module.sleep(0.01)
                continue

            # Skip processing while AI is responding or processing
            if vad_paused or vad_processing:
                time_module.sleep(0.05)
                continue

            for frame_data in frames_to_process:
                # Convert float32 to int16 for webrtcvad
                int16_data = (frame_data * 32767).astype(np.int16)
                raw_bytes = int16_data.tobytes()

                # webrtcvad expects exactly frame_size * 2 bytes (16-bit mono)
                expected_len = VAD_FRAME_SAMPLES * 2
                if len(raw_bytes) != expected_len:
                    # Pad or trim to exact frame size
                    if len(raw_bytes) < expected_len:
                        raw_bytes = raw_bytes + b'\x00' * (expected_len - len(raw_bytes))
                    else:
                        raw_bytes = raw_bytes[:expected_len]

                try:
                    is_speech = vad.is_speech(raw_bytes, SAMPLE_RATE)
                except Exception:
                    is_speech = False

                if is_speech:
                    voiced_count += 1
                    unvoiced_count = 0
                else:
                    unvoiced_count += 1
                    voiced_count = 0

                # --- State transitions ---
                if not is_recording:
                    # Waiting for speech to start
                    if voiced_count >= VAD_SPEECH_FRAMES:
                        is_recording = True
                        record_start_time = time_module.time()
                        vad_audio_frames = []
                        # Include a small pre-buffer (the voiced frames that triggered)
                        vad_audio_frames.append(frame_data.copy())
                        print("[VAD] Recording...", end="", flush=True)
                else:
                    # Currently recording
                    vad_audio_frames.append(frame_data.copy())
                    elapsed = time_module.time() - record_start_time

                    # Stop conditions: silence detected or max duration
                    should_stop = False
                    if unvoiced_count >= VAD_SILENCE_FRAMES:
                        should_stop = True
                    if elapsed >= VAD_MAX_DURATION:
                        print(" (timeout)", end="", flush=True)
                        should_stop = True

                    if should_stop:
                        is_recording = False
                        voiced_count = 0
                        unvoiced_count = 0
                        print(" Done!", flush=True)

                        # Check minimum duration
                        duration = time_module.time() - record_start_time
                        if duration < VAD_MIN_DURATION:
                            print("[VAD] (Too short, ignored)", flush=True)
                            print("[VAD] Ready. Listening...\n", flush=True)
                            vad_audio_frames = []
                            continue

                        # Copy frames and process in background
                        global audio_frames
                        audio_frames = list(vad_audio_frames)
                        vad_audio_frames = []
                        threading.Thread(
                            target=process_recorded_audio,
                            args=("VAD", "[VAD] Ready. Listening..."),
                            kwargs={"vad_mode": True},
                            daemon=True,
                        ).start()

    except KeyboardInterrupt:
        pass

    stream.stop()
    print("\n[VAD] Goodbye!")


# =====================================================================
# Entry point
# =====================================================================

def main():
    parser = argparse.ArgumentParser(description="AI Companion voice chat")
    parser.add_argument(
        "--vad",
        action="store_true",
        help="VAD (Voice Activity Detection) mode: hands-free, auto-detect speech",
    )
    args = parser.parse_args()

    if args.vad:
        main_vad()
    else:
        main_ptt()


if __name__ == "__main__":
    main()
