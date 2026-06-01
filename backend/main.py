import asyncio
import json
import time
from pathlib import Path
from typing import Any

from aiohttp import web
import mido

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"

DEVICE_KEYWORDS = ["TD-17", "Roland TD-17"]


NOTE_MAP = {
    36: {"part": "kick", "zone": "head", "label": "KICK"},
    38: {"part": "snare", "zone": "head", "label": "SNARE HEAD"},
    40: {"part": "snare", "zone": "rim", "label": "SNARE RIM"},
    37: {"part": "snare", "zone": "xstick", "label": "SNARE X-STICK"},
    48: {"part": "tom1", "zone": "head", "label": "TOM 1 HEAD"},
    50: {"part": "tom1", "zone": "rim", "label": "TOM 1 RIM"},
    45: {"part": "tom2", "zone": "head", "label": "TOM 2 HEAD"},
    47: {"part": "tom2", "zone": "rim", "label": "TOM 2 RIM"},
    43: {"part": "tom3", "zone": "head", "label": "TOM 3 HEAD"},
    58: {"part": "tom3", "zone": "rim", "label": "TOM 3 RIM"},
    46: {"part": "hihat", "zone": "open_bow", "label": "HI-HAT OPEN BOW"},
    26: {"part": "hihat", "zone": "open_edge", "label": "HI-HAT OPEN EDGE"},
    42: {"part": "hihat", "zone": "closed_bow", "label": "HI-HAT CLOSED BOW"},
    22: {"part": "hihat", "zone": "closed_edge", "label": "HI-HAT CLOSED EDGE"},
    44: {"part": "hihat", "zone": "pedal", "label": "HI-HAT PEDAL"},
    49: {"part": "crash1", "zone": "bow", "label": "CRASH 1 BOW"},
    55: {"part": "crash1", "zone": "edge", "label": "CRASH 1 EDGE"},
    57: {"part": "crash2", "zone": "bow", "label": "CRASH 2 BOW"},
    52: {"part": "crash2", "zone": "edge", "label": "CRASH 2 EDGE"},
    51: {"part": "ride", "zone": "bow", "label": "RIDE BOW"},
    59: {"part": "ride", "zone": "edge", "label": "RIDE EDGE"},
    53: {"part": "ride", "zone": "bell", "label": "RIDE BELL"},
    27: {"part": "aux", "zone": "head", "label": "AUX HEAD"},
    28: {"part": "aux", "zone": "rim", "label": "AUX RIM"},
}


def find_td17_device_name() -> str | None:
    input_names = mido.get_input_names()

    for name in input_names:
        normalized = name.lower()
        if any(keyword.lower() in normalized for keyword in DEVICE_KEYWORDS):
            return name

    return None


def get_connection_status() -> dict[str, Any]:
    try:
        input_names = mido.get_input_names()
        device_name = None

        for name in input_names:
            normalized = name.lower()
            if any(keyword.lower() in normalized for keyword in DEVICE_KEYWORDS):
                device_name = name
                break

        return {
            "type": "connection",
            "connected": device_name is not None,
            "device_name": device_name,
            "available_inputs": input_names,
            "error": None,
            "timestamp": time.time(),
        }
    except Exception as exc:
        return {
            "type": "connection",
            "connected": False,
            "device_name": None,
            "available_inputs": [],
            "error": str(exc),
            "timestamp": time.time(),
        }


def normalize_midi_message(msg: mido.Message) -> dict[str, Any] | None:
    """
    把 mido.Message 转成前端更容易处理的事件。
    暂时处理三类：
    1. note_on: 鼓件敲击
    2. control_change #4: hi-hat pedal position
    3. polytouch: choke / pressure
    """

    raw_bytes = list(msg.bytes())
    raw_hex = " ".join(f"{b:02X}" for b in raw_bytes)

    base = {
        "timestamp": time.time(),
        "raw": raw_hex,
        "mido": str(msg),
    }

    # 有些设备会用 note_on velocity=0 表示 note_off。
    # 对 overlay 来说可以忽略。
    if msg.type == "note_on" and msg.velocity > 0:
        note = int(msg.note)
        velocity = int(msg.velocity)
        mapped = NOTE_MAP.get(note)

        return {
            **base,
            "type": "hit",
            "channel": int(msg.channel) + 1 if hasattr(msg, "channel") else None,
            "note": note,
            "velocity": velocity,
            "part": mapped["part"] if mapped else "unknown",
            "zone": mapped["zone"] if mapped else "unknown",
            "label": mapped["label"] if mapped else f"UNKNOWN NOTE {note}",
        }

    if msg.type == "control_change" and msg.control == 4:
        value = int(msg.value)

        # Roland 文档里是 open -> closed。这里先给一个粗分类。
        if value < 32:
            openness = "open"
        elif value < 80:
            openness = "half"
        else:
            openness = "closed"

        return {
            **base,
            "type": "hihat_pedal",
            "channel": int(msg.channel) + 1 if hasattr(msg, "channel") else None,
            "control": 4,
            "value": value,
            "openness": openness,
            "label": f"HI-HAT PEDAL {value}",
        }

    # mido 里 polyphonic key pressure 通常叫 polytouch
    if msg.type == "polytouch":
        note = int(msg.note)
        value = int(msg.value)
        mapped = NOTE_MAP.get(note)

        return {
            **base,
            "type": "choke",
            "channel": int(msg.channel) + 1 if hasattr(msg, "channel") else None,
            "note": note,
            "value": value,
            "pressed": value > 0,
            "part": mapped["part"] if mapped else "unknown",
            "zone": mapped["zone"] if mapped else "unknown",
            "label": mapped["label"] if mapped else f"UNKNOWN NOTE {note}",
        }

    # 其他消息暂时过滤：note_off、active_sensing、program_change、sysex 等。
    return None


class MidiMonitor:
    def __init__(self):
        self.clients: set[web.WebSocketResponse] = set()
        self.input_port = None
        self.connected_device_name: str | None = None
        self.reader_task: asyncio.Task | None = None
        self.status_task: asyncio.Task | None = None

    async def start(self):
        self.reader_task = asyncio.create_task(self.reader_loop())
        self.status_task = asyncio.create_task(self.status_loop())

    async def stop(self):
        for task in [self.reader_task, self.status_task]:
            if task:
                task.cancel()

        if self.input_port:
            self.input_port.close()
            self.input_port = None

    async def add_client(self, ws: web.WebSocketResponse):
        self.clients.add(ws)
        await ws.send_str(json.dumps(get_connection_status(), ensure_ascii=False))

    def remove_client(self, ws: web.WebSocketResponse):
        self.clients.discard(ws)

    async def broadcast(self, event: dict[str, Any]):
        if not self.clients:
            return

        dead_clients = []

        payload = json.dumps(event, ensure_ascii=False)

        for ws in self.clients:
            try:
                await ws.send_str(payload)
            except Exception:
                dead_clients.append(ws)

        for ws in dead_clients:
            self.remove_client(ws)

    async def status_loop(self):
        while True:
            await self.broadcast(get_connection_status())
            await asyncio.sleep(1.0)

    async def reader_loop(self):
        """
        持续尝试连接 TD-17。
        连接后读取 MIDI 输入。
        如果设备断开，关闭端口并等待重连。
        """
        while True:
            try:
                device_name = find_td17_device_name()

                if device_name is None:
                    if self.input_port is not None:
                        self.input_port.close()
                        self.input_port = None
                        self.connected_device_name = None

                    await asyncio.sleep(1.0)
                    continue

                if self.input_port is None or self.connected_device_name != device_name:
                    if self.input_port is not None:
                        self.input_port.close()

                    print(f"Opening MIDI input: {device_name}")
                    self.input_port = mido.open_input(device_name)
                    self.connected_device_name = device_name

                # poll() 是非阻塞读取。没有消息就返回 None。
                msg = self.input_port.poll()

                if msg is not None:
                    event = normalize_midi_message(msg)
                    if event is not None:
                        await self.broadcast(event)
                else:
                    await asyncio.sleep(0.001)

            except Exception as exc:
                print(f"MIDI reader error: {exc}")

                if self.input_port is not None:
                    try:
                        self.input_port.close()
                    except Exception:
                        pass

                self.input_port = None
                self.connected_device_name = None

                await self.broadcast(
                    {
                        "type": "connection",
                        "connected": False,
                        "device_name": None,
                        "available_inputs": [],
                        "error": str(exc),
                        "timestamp": time.time(),
                    }
                )

                await asyncio.sleep(1.0)


monitor = MidiMonitor()


async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    await monitor.add_client(ws)
    print("Frontend connected")

    try:
        async for _ in ws:
            # 目前前端不需要发消息给后端。
            pass
    finally:
        monitor.remove_client(ws)
        print("Frontend disconnected")

    return ws


async def index_handler(request):
    return web.FileResponse(FRONTEND_DIR / "index.html")


async def on_startup(app):
    await monitor.start()


async def on_cleanup(app):
    await monitor.stop()


def create_app():
    app = web.Application()

    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)

    app.router.add_get("/", index_handler)
    app.router.add_get("/ws", websocket_handler)

    app.router.add_static(
        "/static/",
        path=FRONTEND_DIR,
        name="static",
    )

    return app


if __name__ == "__main__":
    app = create_app()

    print("TD-17 overlay server running")
    print("Open: http://localhost:8765")

    web.run_app(app, host="0.0.0.0", port=8765)
