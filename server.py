#!/usr/bin/env python3
"""Offline static server. Binds only to loopback and opens the instrument."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import webbrowser

ROOT = Path(__file__).resolve().parent
class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Content-Security-Policy', "connect-src 'self' blob: data:")
        self.send_header('Permissions-Policy', 'camera=(self), microphone=()')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()
    def log_message(self, fmt, *args):
        if args and str(args[1] if len(args)>1 else '') not in ('200','304'):
            super().log_message(fmt,*args)

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description='弦境竖琴本地服务')
    parser.add_argument('--port',type=int,default=8768)
    parser.add_argument('--no-open',action='store_true')
    args=parser.parse_args()
    server=None
    for port in range(args.port,args.port+20):
        try:
            server=ThreadingHTTPServer(('127.0.0.1',port),partial(Handler,directory=str(ROOT)))
            break
        except OSError:
            continue
    if server is None:
        raise SystemExit('本机端口繁忙，请关闭旧服务后重试。')
    url=f'http://127.0.0.1:{server.server_address[1]}/'
    print(f'弦境竖琴已就绪：{url}\n请在浏览器允许摄像头。关闭此窗口会停止服务。',flush=True)
    if not args.no_open:webbrowser.open(url)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
