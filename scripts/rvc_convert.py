"""
RVC 声質変換ラッパー
Usage: python rvc_convert.py <input.wav> <output_dir> <model_name> [pitch]
"""
import sys
import os

def main():
    if len(sys.argv) < 4:
        print("Usage: python rvc_convert.py <input.wav> <output_dir> <model_name> [pitch]", file=sys.stderr)
        sys.exit(1)

    input_wav = sys.argv[1]
    output_dir = sys.argv[2]
    model_name = sys.argv[3]
    pitch = int(sys.argv[4]) if len(sys.argv) > 4 else 0

    if not os.path.exists(input_wav):
        print(input_wav)
        sys.exit(0)

    os.makedirs(output_dir, exist_ok=True)

    try:
        from ultimate_rvc.core.generate.song_cover import convert

        result = convert(
            audio_track=input_wav,
            directory=output_dir,
            model_name=model_name,
            n_semitones=pitch,
            f0_method="rmvpe",
            index_rate=0.5,
            embedder_model="japanese-hubert-base",
            make_directory=True,
        )
        print(str(result))
    except Exception as e:
        print(f"RVC error: {e}", file=sys.stderr)
        print(input_wav)

if __name__ == "__main__":
    main()
