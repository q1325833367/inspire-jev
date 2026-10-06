"""使用 Laya 官方 HTTP 服务，固定模型来源，默认仅监听本机。"""
import argparse
import json
import time
import uvicorn
from laya import Router
from laya.serve import create_app

parser = argparse.ArgumentParser(description="InspireJev 可选本地 Laya 服务")
parser.add_argument("--port", type=int, default=8769)
parser.add_argument("--device", choices=["mps", "cuda", "cpu"], default="cpu")
args = parser.parse_args()
started = time.perf_counter()
router = Router(models={"multilingual": "convaiinnovations/laya-multilingual"},
                revisions={"multilingual": "1720e3e3357cfe1e281542e223f8273b0890ca34"},
                default="multilingual", device=args.device)
router.preload(["multilingual"])
print(json.dumps({"event": "ready", "load_seconds": time.perf_counter() - started,
                  "revisions": router.loaded_revisions}), flush=True)
uvicorn.run(create_app(router), host="127.0.0.1", port=args.port, access_log=False)
