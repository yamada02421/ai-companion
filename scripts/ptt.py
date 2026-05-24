"""
Push-to-Talk 双方向会話
右Altキーを押している間マイク録音 → 離したら音声認識 → AI応答 → 音声再生

起動: python scripts/ptt.py
"""
import sys
import os
import json
import tempfile
import wave
import threading
import struct
from pathlib import Path

# Add project root
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import numpy as np
import sounddevice as sd
from pynput import keyboard

# --- Config ---
SAMPLE_RATE = 16000
CHANNELS = 1
HOTKEY = keyboard.Key.alt_r  # 右Altキー

# --- State ---
recording = False
audio_frames = []
whisper_model = None


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


def chat_and_speak(text: str):
    """Call the AI companion CLI and let it handle response + voice."""
    import subprocess
    cli_path = PROJECT_ROOT / "packages" / "terminal" / "src" / "cli.ts"
    env = os.environ.copy()
    env["COMPANION_CHAR"] = os.environ.get("COMPANION_CHAR", "rei")

    result = subprocess.run(
        ["npx", "tsx", str(cli_path), text],
        capture_output=True, text=True, timeout=60,
        cwd=str(PROJECT_ROOT), env=env,
    )
    if result.stdout.strip():
        print(f"\n[レイ] {result.stdout.strip()}", flush=True)


def on_release_record():
    global recording, audio_frames
    if not audio_frames:
        print("[PTT] No audio captured", flush=True)
        return

    # Save to temp file
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    save_wav(audio_frames, tmp.name)
    audio_frames = []

    # Transcribe
    print("[PTT] Transcribing...", flush=True)
    text = transcribe(tmp.name)
    os.unlink(tmp.name)

    if not text:
        print("[PTT] (No speech detected)", flush=True)
        return

    print(f"[あなた] {text}", flush=True)

    # Chat & speak
    chat_and_speak(text)
    print("\n[PTT] Ready. Hold Right-Alt to talk.", flush=True)


def audio_callback(indata, frames, time, status):
    if recording:
        audio_frames.append(indata.copy())


def on_press(key):
    global recording, audio_frames
    if key == HOTKEY and not recording:
        recording = True
        audio_frames = []
        print("[PTT] 🎤 Recording...", end="", flush=True)


def on_release(key):
    global recording
    if key == HOTKEY and recording:
        recording = False
        print(" Done!", flush=True)
        # Process in separate thread to not block keyboard listener
        threading.Thread(target=on_release_record, daemon=True).start()


def main():
    print("=" * 50)
    print("  Push-to-Talk: 綾波レイと話そう")
    print("  右Altキーを押している間、話してください")
    print("  Ctrl+C で終了")
    print("=" * 50)
    print()

    # Pre-load whisper
    load_whisper()

    # Start audio stream
    stream = sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype="float32",
        callback=audio_callback,
    )
    stream.start()

    print("[PTT] Ready. Hold Right-Alt to talk.\n", flush=True)

    # Listen for hotkey
    with keyboard.Listener(on_press=on_press, on_release=on_release) as listener:
        try:
            listener.join()
        except KeyboardInterrupt:
            pass

    stream.stop()
    print("\n[PTT] Goodbye!")


if __name__ == "__main__":
    main()
