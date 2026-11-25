# oink-kit

Đăng nhập bằng mã email dùng chung cho các game Oink online (Scout, Deep Sea, A Fake Artist Goes to New York, Durian, In a Grove, Insider, maskmen…).

Chỉ **chủ phòng** cần đăng nhập (email nằm trong `HOST_EMAILS`) để tạo phòng. Người chơi khác vào phòng **không cần đăng nhập**: chỉ nhập tên và mã phòng. Email không có quyền tạo phòng sẽ không được gửi mã.

- **`oink-kit/server`**: tạo và kiểm tra mã 6 số, token phiên, `HOST_EMAILS`, route `/auth/*`, middleware Socket.IO (`seatId()` cho cả khách lẫn tài khoản), CORS.
- **`oink-kit/client`**: lưu phiên/pending login/khoá khách trong localStorage, gọi `/auth/request` và `/auth/verify`, `roomCodeInput()` cho ô mã phòng (gõ được bằng bàn phím tiếng Việt Telex).
- **`oink-kit/react`**: hook `useEmailLogin()` (không kèm giao diện, mỗi game tự vẽ form).
- **`oink-kit/relay`**: hàm Vercel gửi mail qua Gmail SMTP. Repo này tự deploy lên Vercel thành relay dùng chung ("oink-mail").

Không cần database. Token được ký HMAC bằng `SESSION_SECRET`, nên server Render có ngủ dậy hay khởi động lại thì người chơi vẫn còn đăng nhập. Định dạng token giữ nguyên như bản SCOUT cũ.

## Cài vào game

```bash
npm install github:hieunguyen250102/oink-kit#v1.1.0
```

Cài ở chỗ code dùng tới: `server/`, `client/` (hoặc root nếu là Next.js).

### Server (Express 4/5)

```ts
import { createAuth, authHandler, socketAuth, authError, seatId, NO_SEAT, originPolicy } from 'oink-kit/server';

const auth = createAuth({ brand: 'SCOUT', devSecret: 'scout-dev-secret', mailAccent: '#f4efe4' });
const origins = originPolicy(process.env.CLIENT_ORIGIN);

app.set('trust proxy', 1);
app.use(cors({ origin: origins.corsOrigin }));
app.use(express.json({ limit: '4kb' }));
app.use(authHandler(auth)); // POST /auth/request, /auth/verify

app.get('/health', (_req, res) =>
  res.json({ ok: true, hostRestricted: auth.hostingIsRestricted(), allowedOrigins: origins.origins }),
);

const io = new Server(server, { cors: { origin: origins.corsOrigin } });
io.use(socketAuth(auth)); // socket.data.user = User | null, socket.data.guestId = string | null

io.on('connection', (socket) => {
  // seatId: id tài khoản nếu đã đăng nhập, không thì id khách của trình duyệt này
  socket.emit('session', { user: socket.data.user, seatId: seatId(socket) });
  socket.on('room:create', (payload, ack) => {
    const err = authError(socket.data.user, { host: true }); // chỉ chủ phòng
    if (err) return ack?.({ error: err });
    // ...
  });
  socket.on('room:join', (payload, ack) => {
    const pid = seatId(socket); // không cần đăng nhập
    if (!pid) return ack?.({ error: NO_SEAT });
    // ...
  });
});
```

Server không dùng Express (vd. `http.createServer` + Next): truyền thêm `allowOrigin` để handler tự trả header CORS:

```ts
const handleAuth = authHandler(auth, { allowOrigin: origins.allows });
createServer((req, res) => {
  if (handleAuth(req, res)) return;
  handle(req, res);
});
```

### Client

```ts
import { createAuthClient } from 'oink-kit/client';
export const authClient = createAuthClient({ storagePrefix: 'scout', serverUrl: SERVER_URL });

const socket = io(SERVER_URL, { auth: authClient.socketAuth });
// sau khi đăng nhập: authClient.saveSession(s); socket.disconnect().connect();
// socketAuth gửi cả { token, guest }: guest là khoá ngẫu nhiên của trình duyệt, server chỉ lộ ra hash của nó.
```

Ô mã phòng: bàn phím tiếng Việt (Telex) biến `w` thành `ư`, `dd` thành `đ`, `as` thành `á`… `roomCodeInput` đổi ngược lại thành các phím đã gõ:

```tsx
import { roomCodeInput } from 'oink-kit/client';

<input value={code} onChange={(e) => setCode(roomCodeInput(e.target.value, code, 4, e.target.selectionStart))} />
```

```tsx
import { useEmailLogin } from 'oink-kit/react';

const login = useEmailLogin(authClient, { onLogin, onSent: sfx.chip, onError: sfx.error });
// login.step: 'email' | 'code'; login.send(), login.typeCode(value), login.verify(login.devCode) ...
```

## Biến môi trường

Server game (Render):

| Biến | Ý nghĩa |
|---|---|
| `SESSION_SECRET` | Khoá ký token. Giữ nguyên để người chơi không bị đăng xuất. |
| `HOST_EMAILS` | Danh sách email được tạo phòng, cách nhau dấu phẩy. Chỉ các email này nhận được mã đăng nhập. Để trống = ai đăng nhập cũng tạo được. |
| `MAIL_RELAY_URL`, `MAIL_RELAY_SECRET` | Relay gửi mail, vd. `https://oink-mail.vercel.app/api/send-code`. |
| `BREVO_API_KEY` / `RESEND_API_KEY` / `SMTP_*` | Các cách gửi khác, nếu không dùng relay. |
| `MAIL_FROM` | Người gửi, vd. `SCOUT <me@gmail.com>`. |

Không có cách gửi mail nào và không chạy production: mã được in ra console và trả về client (`devCode`) để test.

Relay "oink-mail" (Vercel, chính repo này): `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER`, `SMTP_PASS` (App Password của Gmail), `MAIL_FROM`, `MAIL_RELAY_SECRET`. Relay chỉ nhận `{to, code, brand, accent}`: mã phải đúng 6 số, `brand` chỉ được là tên game dạng chữ thường, `accent` là màu `#rrggbb` của ô mã.

## Phát triển

```bash
npm install
npm test
npm run release -- 1.1.0   # build, commit dist/, tag v1.1.0
git push && git push origin v1.1.0
```

`dist/` được commit vì các game cài thẳng từ git. Muốn cập nhật game nào thì đổi tag trong `package.json` của game đó.
