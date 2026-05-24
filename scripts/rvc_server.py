"""
RVC 声質変換サーバー
常駐させてGPUモデルをウォーム状態に保つ。
起動: python scripts/rvc_server.py
"""
import os
import sys
import json
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

_converter = None

def get_converter():
    global _converter
    if _converter is None:
        print("Loading RVC model (first time)...", flush=True)
        from ultimate_rvc.core.generate.song_cover import convert
        _converter = convert
        print("RVC model loaded!", flush=True)
    return _converter

class RVCHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        try:
            params = json.loads(body)
            input_wav = params["input"]
            output_dir = params.get("output_dir", os.path.dirname(input_wav))
            model_name = params.get("model", "Ayanami_Rei")
            pitch = params.get("pitch", 0)

            os.makedirs(output_dir, exist_ok=True)
            convert = get_converter()

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

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "output": str(result)}).encode())

        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode())

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "model_loaded": _converter is not None}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        print(f"[RVC] {args[0]}", flush=True)

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
    # Pre-load model
    get_converter()
    server = HTTPServer(("127.0.0.1", port), RVCHandler)
    print(f"RVC server running on http://127.0.0.1:{port}", flush=True)
    server.serve_forever()
