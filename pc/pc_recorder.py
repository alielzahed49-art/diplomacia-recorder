#!/usr/bin/env python3
"""
Diplomacia PC recorder — يفتح اللعبة في متصفح حقيقي (Chromium) على جهازك ويسجّل كل طلب بيعمله
الموقع الرسمي: الهيدرز (الـ Authorization بيتخبّى)، الـ status، الـ shape بتاع الرد، وشكل رسايل
الـ websocket — ويبعتها لسيرفر البوت (نفس مفتاح سكربت Via). بيحتفظ كمان بنسخة محلية captures.jsonl.

التشغيل (مرة واحدة تثبيت):
    pip install playwright
    playwright install chromium
بعدها:
    python pc_recorder.py            # أول مرة بيسألك عن المفتاح ويحفظه في key.txt
    python pc_recorder.py --key XXXX
سجّل دخول في النافذة اللي هتفتح، العب عادي، وسيب السكربت شغال. Ctrl+C للإيقاف.
"""
import argparse, json, os, re, signal, sys, threading, time, urllib.error, urllib.request, uuid

ENDPOINT = 'https://diplomaciabot-9swm.onrender.com/api/capture'
SITE = 'https://diplomacia.com.tr'
HERE = os.path.dirname(os.path.abspath(__file__))

SENSITIVE_HDR = {'authorization', 'cookie', 'set-cookie', 'x-auth-token'}
KEEP_RESP_HDR = {'server', 'content-type', 'cf-ray', 'cf-cache-status', 'retry-after', 'date',
                 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'ratelimit-limit',
                 'ratelimit-remaining', 'ratelimit-reset', 'cache-control', 'etag', 'content-encoding',
                 'access-control-allow-origin', 'via', 'x-powered-by'}
TOKEN_RE = re.compile(r'[A-Za-z0-9._~+/=-]{40,}')


def redact(s):
    return TOKEN_RE.sub('<tok>', s or '')


def mask_headers(h):
    out = {}
    for k, v in (h or {}).items():
        lk = k.lower()
        if lk == 'authorization':
            out[lk] = 'Bearer <%d chars>' % max(0, len(v) - 7)
        elif lk in ('cookie',):
            out[lk] = 'names: ' + ','.join(c.split('=')[0].strip() for c in v.split(';'))
        elif lk in SENSITIVE_HDR:
            out[lk] = '<hidden>'
        else:
            out[lk] = v[:160]
    return out


def shape(v, d=0):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'boolean'
    if isinstance(v, (int, float)):
        return 'number'
    if isinstance(v, str):
        return 'string'
    if isinstance(v, list):
        return '[%s]x%d' % (json.dumps(shape(v[0], d + 1)) if v else '', len(v))
    if isinstance(v, dict):
        if d > 2:
            return '{..}'
        return {k: shape(x, d + 1) for k, x in list(v.items())[:30]}
    return type(v).__name__


class Sender:
    def __init__(self, key, endpoint):
        self.key, self.endpoint = key, endpoint
        self.buf, self.lock = [], threading.Lock()
        self.session = uuid.uuid4().hex[:8]
        self.sent = self.failed = 0
        self.log = open(os.path.join(HERE, 'captures.jsonl'), 'a', encoding='utf-8')
        threading.Thread(target=self._loop, daemon=True).start()

    def add(self, ev):
        with self.lock:
            self.buf.append(ev)
        self.log.write(json.dumps(ev, ensure_ascii=False) + '\n')
        self.log.flush()

    def _loop(self):
        while True:
            time.sleep(5)
            self.flush()

    def flush(self):
        with self.lock:
            batch, self.buf = self.buf[:60], self.buf[60:]
        if not batch:
            return
        body = json.dumps({'key': self.key, 'session': self.session, 'ua': 'pc-recorder', 'page': 'pc',
                           'events': batch}).encode()
        try:
            req = urllib.request.Request(self.endpoint, data=body, headers={'Content-Type': 'application/json'})
            urllib.request.urlopen(req, timeout=20).read()
            self.sent += len(batch)
        except Exception as e:
            self.failed += len(batch)
            print('  ! send failed (%s) - kept locally in captures.jsonl' % e)


def find_chrome():
    """Real installed Chrome/Edge (Google refuses sign-in inside Playwright's own browser)."""
    c = []
    for env in ('ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'):
        base = os.environ.get(env)
        if base:
            c.append(os.path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    for env in ('ProgramFiles(x86)', 'ProgramFiles'):
        base = os.environ.get(env)
        if base:
            c.append(os.path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
    c += ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome',
          '/usr/bin/chromium', '/usr/bin/chromium-browser']
    for p in c:
        if os.path.exists(p):
            return p
    return None


def start_real_chrome(path, port, site, headless=False):
    """Launch plain Chrome with a remote-debugging port (no automation flags) and wait until it answers."""
    import subprocess
    args = [path, '--remote-debugging-port=%d' % port, '--user-data-dir=' + os.path.join(HERE, 'chrome-profile'),
            '--no-first-run', '--no-default-browser-check']
    if hasattr(os, 'geteuid') and os.geteuid() == 0:
        args.append('--no-sandbox')  # Chrome refuses to start as root on Linux without it
    if headless:
        args.append('--headless=new')
    args.append(site)
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        try:
            urllib.request.urlopen('http://127.0.0.1:%d/json/version' % port, timeout=1).read()
            return proc
        except Exception:
            time.sleep(0.5)
    proc.terminate()
    raise RuntimeError('Chrome did not start with the debugging port')


def check_key(endpoint, key):
    """Send an empty batch: 200 = key accepted, 403 = wrong key."""
    body = json.dumps({'key': key, 'session': 'check', 'ua': 'pc-recorder', 'page': 'pc', 'events': []}).encode()
    try:
        req = urllib.request.Request(endpoint, data=body, headers={'Content-Type': 'application/json'})
        urllib.request.urlopen(req, timeout=25).read()
        return True, ''
    except urllib.error.HTTPError as e:
        return False, 'wrong key (HTTP %d)' % e.code if e.code == 403 else 'server error HTTP %d' % e.code
    except Exception as e:
        return None, 'cannot reach server: %s' % e


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--key', help='مفتاح الالتقاط (من لوحة الأدمن)')
    ap.add_argument('--endpoint', default=ENDPOINT)
    ap.add_argument('--site', default=SITE)
    ap.add_argument('--headless', action='store_true')
    ap.add_argument('--playwright-browser', action='store_true', help='use Playwright\'s own Chromium (Google sign-in will be blocked there)')
    ap.add_argument('--port', type=int, default=9222)
    ap.add_argument('--chromium-path', help='مسار متصفح Chromium لو عايز تستخدم متصفح مثبت عندك')
    a = ap.parse_args()

    key_file = os.path.join(HERE, 'key.txt')
    key = (a.key or '').strip()
    if not key and os.path.exists(key_file):
        key = open(key_file).read().strip()
    for attempt in range(3):
        if not key:
            key = input('Paste the capture KEY (admin panel -> request recorder -> copy key): ').strip()
        ok, why = check_key(a.endpoint, key)
        if ok is False:
            print('  X %s. The key is the long secret string, not a link.' % why)
            key = ''
            if os.path.exists(key_file):
                os.remove(key_file)
            continue
        if ok is None:
            print('  ! %s (will keep recording locally and retry sending)' % why)
        open(key_file, 'w').write(key)
        break
    else:
        print('Key still rejected - stopping.')
        return 1

    from playwright.sync_api import sync_playwright
    sender = Sender(key, a.endpoint)
    host = re.sub(r'^https?://', '', a.site).split('/')[0]
    pending = {}  # request -> start time

    def is_api(url):
        return host in url and '/api/' in url

    def path_of(url):
        return re.sub(r'^https?://[^/]+', '', url)[:200]

    with sync_playwright() as p:
        proc = None
        if a.playwright_browser:
            ctx = p.chromium.launch_persistent_context(os.path.join(HERE, 'profile'), headless=a.headless,
                                                       viewport=None, args=['--start-maximized'],
                                                       executable_path=a.chromium_path or None)
        else:
            chrome = a.chromium_path or find_chrome()
            if not chrome:
                print('Chrome/Edge not found. Install Chrome, or pass --chromium-path "C:\\path\\to\\chrome.exe".')
                return 1
            print('Starting your real browser: %s' % chrome)
            proc = start_real_chrome(chrome, a.port, a.site, a.headless)
            browser = p.chromium.connect_over_cdp('http://127.0.0.1:%d' % a.port)
            ctx = browser.contexts[0]
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        def on_request(req):
            if is_api(req.url):
                pending[req] = time.time()

        def on_response(resp):
            req = resp.request
            if not is_api(req.url):
                return
            t0 = pending.pop(req, time.time())
            ms = int((time.time() - t0) * 1000)
            body, sh, sample = '', '', ''
            try:
                raw = resp.body()
                txt = raw.decode('utf-8', 'replace')
            except Exception:
                txt = ''
            try:
                sh = json.dumps(shape(json.loads(txt)))[:1500]
            except Exception:
                sh = '(non-json)'
            # العيّنة: دايمًا للأخطاء (403/401/429) عشان نشوف جسم الرد، ولأول مرتين لباقي الطلبات
            if resp.status >= 400 or not sender_seen(req.method, req.url, resp.status):
                sample = redact(txt)[:1200]
            try:
                body = redact(req.post_data or '')[:500]
            except Exception:
                body = ''
            try:
                rh = json.dumps(mask_headers(req.all_headers()), ensure_ascii=False)
            except Exception:
                rh = ''
            try:
                ph = json.dumps({k: v for k, v in resp.all_headers().items() if k.lower() in KEEP_RESP_HDR},
                                ensure_ascii=False)
            except Exception:
                ph = ''
            sender.add({'t': int(time.time() * 1000), 'm': req.method, 'u': path_of(req.url), 's': resp.status,
                        'ms': ms, 'rb': body, 'sh': sh, 'sa': sample, 'len': len(txt), 'rh': rh, 'ph': ph})

        def on_failed(req):
            if is_api(req.url):
                pending.pop(req, None)
                sender.add({'t': int(time.time() * 1000), 'm': req.method, 'u': path_of(req.url), 's': 0, 'ms': 0,
                            'rb': '', 'sh': '', 'sa': (req.failure or '')[:200], 'len': 0})

        seen = {}

        def sender_seen(method, url, status):
            k = '%s %s %s' % (method, re.sub(r'[0-9a-f]{8,}|\d+', 'N', path_of(url)), status)
            seen[k] = seen.get(k, 0) + 1
            return seen[k] > 2

        ws_count = {}

        def on_ws(ws):
            if host not in ws.url:
                return
            sender.add({'t': int(time.time() * 1000), 'm': 'WS', 'u': re.sub(r'(token|key)=[^&]*', r'\1=<x>', ws.url)[:200],
                        's': 0, 'ms': 0, 'rb': '', 'sh': '', 'sa': '', 'len': 0})

            def frame(direction):
                def h(payload):
                    txt = payload if isinstance(payload, str) else ''
                    m = re.match(r'^\d+(\["([^"]+)")?', txt)
                    name = (m.group(2) if m and m.group(2) else (txt[:2] or 'bin'))
                    k = direction + ' ' + name
                    ws_count[k] = ws_count.get(k, 0) + 1
                    if ws_count[k] <= 2:
                        sender.add({'t': int(time.time() * 1000), 'm': 'WSMSG', 'u': k, 's': 0, 'ms': 0, 'rb': '',
                                    'sh': '', 'sa': redact(txt)[:600], 'len': len(txt)})
                return h
            ws.on('framereceived', frame('recv'))
            ws.on('framesent', frame('send'))

        ctx.on('request', on_request)
        ctx.on('response', on_response)
        ctx.on('requestfailed', on_failed)
        page.on('websocket', on_ws)
        ctx.on('page', lambda pg: pg.on('websocket', on_ws))

        page.goto(a.site)
        print('OK recording. Log in to the game and play normally. Session: %s' % sender.session)
        print('   Press Ctrl+C (or close the browser) to stop.')
        # مهم: في وضع Playwright المتزامن الأحداث بتتعالج بس أثناء استدعاءات Playwright نفسها،
        # فلازم نستخدم wait_for_timeout بدل time.sleep. Ctrl+C أو قفل المتصفح بيوقفوا السكربت.
        stop = {'v': False}
        signal.signal(signal.SIGINT, lambda *_: stop.update(v=True))
        try:
            signal.signal(signal.SIGTERM, lambda *_: stop.update(v=True))
        except Exception:
            pass
        last = time.time()
        try:
            while not stop['v']:
                page.wait_for_timeout(1000)
                if time.time() - last >= 15:
                    last = time.time()
                    print('  ... sent %d events, failed %d' % (sender.sent, sender.failed))
        except Exception:
            print('Browser closed - stopping.')
        finally:
            sender.flush()
            # ملخص WS
            for k, n in ws_count.items():
                sender.add({'t': int(time.time() * 1000), 'm': 'WSMSG', 'u': k, 's': 0, 'ms': 0, 'rb': '', 'sh': '',
                            'sa': '', 'len': n})
            sender.flush()
            try:
                if proc is not None:
                    browser.close()   # just disconnects; your Chrome window stays open
                else:
                    ctx.close()
            except Exception:
                pass
            print('Done. sent %d, failed %d. Local copy: captures.jsonl' % (sender.sent, sender.failed))


if __name__ == '__main__':
    sys.exit(main())
