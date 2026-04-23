"""Quick smoke-test for /api/register, /api/login."""
import urllib.request, json

BASE = "http://localhost:5000"

def post(path, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        BASE + path, data=data,
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

# 1. Register
code, body = post("/api/register", {"name": "Ashwini Kadam", "email": "ashwini@saferoute.com", "password": "mypass99"})
print("[REGISTER]  ", code, body)

# 2. Duplicate email
code, body = post("/api/register", {"name": "Dup", "email": "ashwini@saferoute.com", "password": "mypass99"})
print("[DUP EMAIL] ", code, body)

# 3. Login OK
code, body = post("/api/login", {"email": "ashwini@saferoute.com", "password": "mypass99"})
token = body.get("access_token", "")
print("[LOGIN OK]  ", code, "token=" + token[:30] + "...", "user=" + str(body.get("user")))

# 4. Wrong password -> 401
code, body = post("/api/login", {"email": "ashwini@saferoute.com", "password": "wrongpass"})
print("[WRONG PASS]", code, body)
