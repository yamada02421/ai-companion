"""
OpenPets アイドルアニメーション — ペットを生きてるように動かし続ける
Claude API 不使用。ローカル IPC のみ。

起動: python scripts/pet_idle.py
停止: Ctrl+C
"""
import json
import os
import random
import time
import uuid
import struct

APPDATA = os.environ.get("APPDATA", "")
IPC_CONFIG_PATH = os.path.join(APPDATA, "OpenPets", "runtime", "ipc.json")

# リアクションとその重み（自然な挙動になるよう調整）
IDLE_REACTIONS = [
    ("idle",        40),   # 基本の待機が一番多い
    ("thinking",    20),   # たまに考え事
    ("waving",       8),   # たまに手を振る
    ("waiting",     15),   # ぼんやり待ってる
    ("success",      5),   # ふとニコッとする
    ("celebrating",  2),   # ごく稀にはしゃぐ
    ("working",      5),   # 何かやってるフリ
    ("editing",      5),   # 何か書いてるフリ
]

# 切り替え間隔（秒）: min〜max のランダム
INTERVAL_MIN = 5
INTERVAL_MAX = 15

# リアクション後、ラベルを消すまでの待ち（秒）
LABEL_CLEAR_DELAY = 1.5


def load_config():
    with open(IPC_CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def send_ipc(config, method, params):
    """OpenPets IPC に直接リクエストを送る（名前付きパイプ）"""
    import socket

    pipe_path = config["endpoint"]
    request = json.dumps({
        "id": str(uuid.uuid4()),
        "version": config["protocolVersion"],
        "token": config["token"],
        "method": method,
        "params": params,
    }) + "\n"

    # Windows named pipe
    import ctypes
    import ctypes.wintypes

    GENERIC_READ_WRITE = 0xC0000000
    OPEN_EXISTING = 3
    INVALID_HANDLE = ctypes.wintypes.HANDLE(-1).value

    handle = ctypes.windll.kernel32.CreateFileW(
        pipe_path,
        GENERIC_READ_WRITE,
        0, None,
        OPEN_EXISTING,
        0, None,
    )
    if handle == INVALID_HANDLE:
        raise ConnectionError(f"Cannot connect to pipe: {pipe_path}")

    try:
        data = request.encode("utf-8")
        written = ctypes.wintypes.DWORD()
        ctypes.windll.kernel32.WriteFile(
            handle, data, len(data), ctypes.byref(written), None
        )

        buf = ctypes.create_string_buffer(4096)
        read = ctypes.wintypes.DWORD()
        ctypes.windll.kernel32.ReadFile(
            handle, buf, 4096, ctypes.byref(read), None
        )
        response = buf.value.decode("utf-8").strip()
        return json.loads(response) if response else None
    finally:
        ctypes.windll.kernel32.CloseHandle(handle)


def acquire_lease(config):
    res = send_ipc(config, "lease.acquire", {})
    if res and res.get("ok") and res.get("result"):
        return res["result"]["leaseId"]
    return None


def react(config, reaction):
    lease_id = acquire_lease(config)
    if not lease_id:
        return False
    res = send_ipc(config, "pet.react", {
        "reaction": reaction,
        "leaseId": lease_id,
    })
    if not (res and res.get("ok", False)):
        return False
    # ラベルが出るので、すぐ idle に戻してテキスト表示を消す
    time.sleep(LABEL_CLEAR_DELAY)
    lease_id2 = acquire_lease(config)
    if lease_id2:
        send_ipc(config, "pet.react", {
            "reaction": "idle",
            "leaseId": lease_id2,
        })
    return True


def pick_reaction(prev):
    """重み付きランダムで次のリアクションを選ぶ（同じのが連続しにくい）"""
    choices = [(r, w) for r, w in IDLE_REACTIONS if r != prev]
    total = sum(w for _, w in choices)
    roll = random.uniform(0, total)
    cumulative = 0
    for r, w in choices:
        cumulative += w
        if roll <= cumulative:
            return r
    return "idle"


def main():
    print("=" * 45)
    print("  OpenPets Idle Animation")
    print(f"  Interval: {INTERVAL_MIN}-{INTERVAL_MAX}s")
    print("  Ctrl+C to stop")
    print("=" * 45)

    config = load_config()
    prev = ""

    while True:
        reaction = pick_reaction(prev)
        ok = react(config, reaction)
        status = "OK" if ok else "FAIL"
        print(f"  [{status}] {reaction}", flush=True)
        prev = reaction

        interval = random.uniform(INTERVAL_MIN, INTERVAL_MAX)
        time.sleep(interval)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.")
    except FileNotFoundError:
        print(f"OpenPets not running? Config not found: {IPC_CONFIG_PATH}")
