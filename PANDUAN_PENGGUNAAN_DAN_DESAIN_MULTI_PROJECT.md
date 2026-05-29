# Panduan Penggunaan + Desain Multi-Project Remote (Claude Code Telegram)

Dokumen ini memisahkan dua kondisi:
- **Saat ini**: plugin menghubungkan satu bot Telegram ke satu Claude Code session.
- **Target desain**: satu bot Telegram menjadi router untuk banyak project dan banyak Claude Code session yang berjalan paralel.

Bagian setup awal menjelaskan perilaku dasar. Bagian multi-project menjelaskan UX router yang kini tersedia beserta hardening lanjutan yang masih ada di roadmap.

---

## 1) Cara Penggunaan (Start Here)

## 1.1 Prasyarat
- Bun terpasang.
- Akun Telegram.
- Bot token dari `@BotFather`.

## 1.2 Instal plugin (fork)
Plugin ini **fork** dari plugin `telegram` resmi Anthropic, jadi tidak diinstal
dari marketplace resmi. Repo ini sudah membawa manifest marketplace sendiri
(`name: telegram-plugin`). Di Claude Code session:

```bash
# dari clone lokal:
/plugin marketplace add /path/ke/claude_plugins-telegram
# atau, setelah fork dipush ke GitHub:
/plugin marketplace add putu-eka-mulyana/telegram-claude-code

/plugin install telegram@telegram-plugin
/reload-plugins
```

Identifier marketplace selalu `telegram-plugin` (sama untuk install lokal
maupun GitHub). Langkah lengkap + cara update ada di **[INSTALL.md](./INSTALL.md)**.

## 1.3 Set token bot
```bash
/telegram:configure <TOKEN_BOT>
```

Token akan disimpan ke:
- `~/.claude/channels/telegram/.env`

## 1.4 Jalankan Claude dengan channel Telegram
```bash
claude --channels plugin:telegram@telegram-plugin
```

## 1.5 Pairing pertama kali
1. DM bot di Telegram.
2. Bot kirim pairing code 6 karakter.
3. Di Claude Code:

```bash
/telegram:access pair <CODE>
```

## 1.6 Lockdown setelah pairing
Setelah user utama masuk, ganti policy ke allowlist:

```bash
/telegram:access policy allowlist
```

Ini penting supaya bot tidak membalas pairing code ke DM acak.

---

## 2) Operasional Harian

## 2.1 Alur normal
1. User kirim pesan ke bot Telegram.
2. Pesan diteruskan ke Claude Code session.
3. Claude balas lewat tool `reply`.

## 2.2 File/foto lampiran
- Foto inbound diunduh ke inbox lokal plugin.
- Untuk dokumen/audio/video, metadata attachment dikirim ke Claude.
- Claude bisa panggil `download_attachment` untuk mengambil file fisik.

## 2.3 Perintah akses utama
- Cek status:
  - `/telegram:access`
- Allow manual user id:
  - `/telegram:access allow <user_id>`
- Hapus akses:
  - `/telegram:access remove <user_id>`
- Group add:
  - `/telegram:access group add <group_id>`
- Group remove:
  - `/telegram:access group rm <group_id>`

---

## 3) Target UX: Satu Bot untuk Banyak Project

Target: user membuka satu chat Telegram, memilih project dan session Claude Code melalui button, lalu pesan biasa menjadi prompt untuk session yang dipilih.

## 3.1 Prinsip target
- Satu **Telegram Router** saja yang menyimpan token bot dan menjalankan `getUpdates`.
- Router mengenal daftar project yang boleh diakses.
- Satu project dapat memiliki beberapa Claude Code session aktif.
- Target aktif disimpan **per chat Telegram**, bukan global.
- Session dapat dijalankan manual dari terminal atau dibuat dari Telegram.
- Setiap prompt harus mempunyai target eksplisit: `chat_id -> project_id -> session_id`.

Dengan prinsip ini, banyak Claude Code dapat berjalan otomatis tanpa berebut token bot Telegram.

## 3.2 Navigasi button

Perintah utama:

```text
/project_list
```

Balasan bot:

```text
Pilih project:

[ Billing API        | 2 sessions online ]
[ Landing Page       | offline           ]
[ Internal Tools     | 1 session online  ]
```

Setelah memilih `Billing API`:

```text
Project: Billing API
Pilih session:

[ terminal-1 | online | last active 2m ago ]
[ remote-2   | idle   | managed by bot   ]
[ + Start New Session ]
[ < Back to Projects  ]
```

Setelah memilih `terminal-1`:

```text
Target aktif: Billing API / terminal-1
Pesan berikutnya akan diprompt ke session ini.

[ Switch Session ] [ Switch Project ] [ Status ]
```

Pesan biasa setelah itu, misalnya `cek kenapa invoice gagal dibuat`, diteruskan hanya ke `Billing API / terminal-1`.

## 3.3 Simulasi penggunaan utama

### Simulasi A: masuk ke session yang sudah running
1. Developer telah menjalankan dua Claude Code session: `Billing API / terminal-1` dan `Internal Tools / terminal-1`.
2. User mengirim `/project_list` di Telegram.
3. Bot menampilkan button kedua project beserta jumlah session online.
4. User menekan `Billing API`, lalu `terminal-1`.
5. Router menyimpan binding chat:

```text
chat_id=8123 -> project=billing-api -> session=terminal-1
```

6. User mengirim prompt biasa.
7. Router meneruskan prompt ke session tersebut dan mengirim jawaban Claude kembali ke chat yang sama.

### Simulasi B: start session baru dari Telegram
1. User memilih `Landing Page`, yang belum mempunyai session online.
2. Bot menampilkan button `[ + Start New Session ]`.
3. User menekan button tersebut.
4. Router menjalankan managed Claude Code session di working directory project yang sudah terdaftar.
5. User menekan `Refresh Sessions`; saat session siap bot menampilkan session baru, misalnya `managed-1234 | online`, dan user memilihnya.
6. Setelah dipilih, prompt berikutnya masuk ke `Landing Page / remote-1`.

### Simulasi C: pindah project dalam chat yang sama
1. Target chat saat ini adalah `Billing API / terminal-1`.
2. User menekan `[ Switch Project ]` atau mengirim `/project_list`.
3. User memilih `Internal Tools / terminal-1`.
4. Router mengganti binding chat; prompt baru tidak lagi masuk ke Billing API.
5. Balasan pekerjaan lama yang masih berjalan harus tetap diberi label asal session agar tidak membingungkan user.

### Simulasi D: memilih beberapa session dalam satu project
1. Project `Billing API` mempunyai `terminal-1` dan `remote-2`.
2. User memilih project tersebut lalu memilih `remote-2`.
3. Prompt diarahkan ke konteks `remote-2`, bukan session terakhir yang aktif secara otomatis.
4. User dapat kembali ke `[ Switch Session ]` untuk memilih `terminal-1`.

### Simulasi E: session terminal didaftarkan ke router
1. Developer menjalankan Claude Code manual di direktori project.
2. Konektor Telegram session mendaftarkan `project_id`, `session_id`, label, status, dan kemampuan menerima prompt ke router.
3. Session muncul sebagai button `terminal-*` di Telegram tanpa harus dimulai oleh bot.
4. Ketika proses terminal berhenti, registry menandainya offline dan router tidak mengirim prompt baru ke session itu.

## 3.4 Konfigurasi implementasi

Fitur router diaktifkan bila session dijalankan dengan `TELEGRAM_PROJECT_ID`
yang terdaftar pada `~/.claude/channels/telegram/projects.json`:

```json
{
  "projects": {
    "billing": {
      "label": "Billing API",
      "workingDirectory": "/absolute/path/to/billing",
      "enabled": true,
      "launchCommand": ["claude", "--channels", "plugin:telegram@telegram-plugin"]
    }
  }
}
```

Contoh menjalankan connector manual:

```bash
TELEGRAM_PROJECT_ID=billing TELEGRAM_SESSION_LABEL=terminal-1 \
  claude --channels plugin:telegram@telegram-plugin
```

Semua connector multi-project harus berbagi `TELEGRAM_STATE_DIR` dan token yang
sama. Router menyimpan heartbeat, binding per chat, serta queue notification di
subdirektori `router/`. Variabel opsional: `TELEGRAM_SESSION_ID` dan
`TELEGRAM_SESSION_ORIGIN=manual|managed`. Identitas session dinamespace oleh
project, jadi `terminal-1` boleh ada pada beberapa project tanpa salah route.

---

## 4) Ringkasan Cara Kerja Codebase Saat Ini

## 4.1 File inti
- `server.ts` → implementasi penuh MCP server Telegram.
- `package.json` → runtime Bun + dependency MCP SDK dan grammy.
- `.mcp.json` → command spawn server (`bun run ... start`).
- `README.md`, `ACCESS.md` → panduan setup dan policy akses.

## 4.2 Startup flow
1. Load env dari state dir (`.env`).
2. Validasi `TELEGRAM_BOT_TOKEN`.
3. Inisialisasi bot grammy.
4. Jalankan MCP server stdio.
5. Mulai polling Telegram dengan retry/backoff.

## 4.3 Access flow
- Access file: `access.json`.
- `dmPolicy`: `pairing` / `allowlist` / `disabled`.
- Pairing pending disimpan di `pending` dengan expiry.
- Outbound tool (`reply/react/edit`) hanya boleh ke chat yang allowed.

## 4.4 Inbound -> Claude flow
- Semua inbound masuk `gate()` dulu.
- Jika tidak lolos: drop.
- Jika butuh pairing: kirim pairing instruction.
- Jika lolos: kirim `notifications/claude/channel` + metadata (`chat_id`, `message_id`, `user`, `user_id`, `ts`, image/attachment meta).

---

## 5) Gap terhadap Target Multi-Project

Constraint arsitektur saat ini:
- Global state dir (`STATE_DIR`) dan file akses tunggal.
- Global bot instance tunggal.
- PID file tunggal untuk anti-stale poller.
- Permission cache (`pendingPermissions`) global.
- Inbound message langsung dinotifikasikan ke satu MCP connection, belum mempunyai router target session.
- Belum ada project registry, session registry, binding per chat, atau managed session launcher.

Selain itu, Telegram hanya mengizinkan satu consumer `getUpdates` untuk satu bot token. Banyak instance plugin yang memakai token sama akan menyebabkan `409 Conflict`; karena itu hanya Router yang boleh melakukan polling.

---

## 6) Desain Target: Telegram Router + Session Registry

## 6.1 Komponen

| Komponen | Tanggung jawab |
| --- | --- |
| Telegram Router | Satu-satunya pemilik bot token, polling Telegram, access gate, rendering inline keyboard, routing inbound/outbound. |
| Project Registry | Menyimpan project yang tersedia: `project_id`, label, working directory, status enabled. |
| Session Registry | Menyimpan session per project: `session_id`, asal `manual`/`managed`, status, last seen, channel komunikasi. |
| Chat Binding Store | Menyimpan pilihan aktif per `chat_id`: project dan session yang menerima prompt selanjutnya. |
| Session Connector | Jembatan dari Claude Code session manual/managed untuk register, heartbeat, menerima prompt, dan mengirim response. |
| Managed Session Launcher | Menjalankan Claude Code session baru dari button `Start New Session` hanya untuk project yang diizinkan. |

## 6.2 Data routing minimum

```text
Project
  id, label, working_directory, enabled

Session
  id, project_id, label, origin(manual|managed), status, last_seen

ChatBinding
  chat_id, project_id, session_id, updated_at

RoutedMessage
  telegram_message_id, chat_id, project_id, session_id, status
```

## 6.3 Alur data
1. Router menerima `/project_list` dan membaca project registry.
2. Callback button project membaca session registry untuk project pilihan.
3. Callback button session menulis `ChatBinding`.
4. Pesan non-command memerlukan binding session yang masih online.
5. Router membungkus pesan dengan identitas `chat_id`, `project_id`, `session_id`, dan `telegram_message_id`, lalu mengirim ke connector session.
6. Connector mengirim response session kembali ke Router dengan identitas target asal.
7. Router mengirim response ke Telegram dan menampilkan label project/session bila ada perpindahan target atau response terlambat.

## 6.4 Aturan keselamatan dan error UX
- Button `Start New Session` hanya tersedia untuk project yang sudah ada di allowlist registry; user tidak boleh mengirim path arbitrary dari Telegram.
- Access policy tetap divalidasi sebelum `/project_list`, callback button, dan prompt biasa diproses.
- Jika belum memilih session, pesan biasa dibalas dengan arahan untuk menjalankan `/project_list`.
- Jika session offline sebelum prompt dikirim, router menolak prompt dan menampilkan button memilih session lain atau memulai session baru.
- Jika response datang setelah user berpindah target, response tetap dikirim dengan label `[Billing API / terminal-1]`.
- Session manual harus melakukan heartbeat; session yang melewati timeout tidak boleh dianggap online.
- Permission request dan approval harus membawa `session_id` agar approval tidak masuk ke session yang salah.

---

## 7) Roadmap Perubahan

Status implementasi saat ini:
- Tersedia: registry project (+ skill `/telegram:projects`), heartbeat session, binding per chat, queue prompt lintas connector, `/project_list` dengan jumlah session online, pemilihan session button (label origin + last-active), tombol Ganti Session/Ganti Project/Status, managed start berbasis konfigurasi, **limit jumlah managed session per project** (`maxManagedSessions`, default 3), routing permission approval ke session asal, **failover router otomatis** (connector yang masih hidup mengambil alih polling saat router lama keluar), dan **label response** `[Project / session]` saat balasan datang dari session yang bukan target aktif chat.
- Belum lengkap: status/progress realtime managed process (startup/restart visibility).

## Phase 1: Router foundation + project selection (implemented)
Fokus: satu bot, daftar project, dan binding project per chat.

Deliverables:
1. Pisahkan polling Telegram/access gate menjadi proses Router tunggal.
2. Tambahkan konfigurasi project registry yang hanya mengizinkan working directory terdaftar.
3. Implementasikan `/project_list` dan inline keyboard pemilihan project.
4. Simpan pilihan project per `chat_id`.

Verifikasi:
- Dua chat dapat memilih project berbeda tanpa saling mengubah target.
- Hanya satu proses yang melakukan `getUpdates` untuk bot token.
- Project di luar registry tidak dapat dipilih atau di-start.

## Phase 2: Session registry + pemilihan session manual (implemented)
Fokus: beberapa Claude Code session dalam satu project.

Deliverables:
1. Definisikan protokol Session Connector untuk register, heartbeat, disconnect, prompt, dan response.
2. Tampilkan daftar session online sebagai button setelah user memilih project.
3. Simpan binding `chat_id -> project_id -> session_id`.
4. Route prompt dan response hanya melalui session terpilih.

Verifikasi:
- Dua session di project yang sama dapat dipilih secara eksplisit.
- Stop session terminal mengubah status menjadi offline.
- Prompt tidak otomatis jatuh ke session lain saat target offline.

## Phase 3: Managed session launcher dari Telegram (implemented; limit aktif)
Fokus: button `Start New Session`.

Deliverables:
1. Tambahkan launcher session untuk project yang terdaftar.
2. Bedakan label `manual` dan `managed` pada daftar session.
3. Tambahkan status startup, timeout, shutdown, dan restart managed session.
4. Terapkan limit jumlah managed session per project/user untuk mencegah proses tak terkendali.

Verifikasi:
- Project offline dapat memulai session dan menerima prompt setelah ready.
- Kegagalan start ditampilkan tanpa meninggalkan binding palsu.
- Session managed dapat dihentikan dan dibersihkan tanpa meninggalkan proses orphan.

## Phase 4: Hardening conversation dan permission routing (in progress)
Fokus: operasi paralel aman untuk penggunaan harian.

Deliverables:
1. Label response terlambat setelah user switch project/session.
2. Scope permission approval dan attachment terhadap session sumber.
3. Audit access control, logging, recovery setelah Router restart, dan concurrency.
4. Tambahkan status screen untuk melihat project/session aktif dalam chat.

Verifikasi:
- Response dan permission tidak bocor antar session/project.
- Binding dapat dipulihkan atau dibatalkan secara jelas setelah restart.
- Skenario simulasi pada Bagian 3 lulus sebagai acceptance test.

---

## 8) Acceptance Scenario untuk Implementasi

1. Jalankan Router dengan satu token bot dan setidaknya dua project terdaftar.
2. Jalankan dua session manual di project yang berbeda dan pastikan keduanya muncul pada button Telegram.
3. Pilih session A, kirim prompt, dan pastikan hanya session A menerima prompt.
4. Pindah ke session B pada chat yang sama dan pastikan prompt berikutnya masuk ke session B.
5. Dari chat Telegram kedua, pilih session A dan pastikan binding kedua chat independen.
6. Pilih project tanpa session aktif, tekan `Start New Session`, lalu kirim prompt setelah session managed siap.
7. Matikan session yang sedang dipilih dan pastikan router menawarkan pilih/start session alih-alih salah route.
8. Uji response terlambat serta permission approval setelah switch target dan pastikan keduanya berlabel/ter-scope ke session asal.

---

## 9) Batas Scope Versi Pertama
- Satu bot Telegram, bukan satu bot per project.
- DM atau chat yang sudah lolos access gate; policy akses yang ada tetap menjadi lapisan pertama.
- Project harus dikonfigurasi sebelumnya oleh operator lokal.
- Sesi paralel harus dipilih secara eksplisit; tidak ada auto-route ke "last active session".
- Tidak mencakup pembagian beban prompt ke banyak session seperti job queue.

---

## 10) Next Step Plan
1. Petakan boundary `server.ts` yang harus dipindahkan ke Router dan fungsi yang tetap dapat dipakai untuk Telegram access/delivery.
2. Tetapkan format project registry, session registry, chat binding, dan protokol connector sebelum membuat kode.
3. Implementasikan berurutan dari Phase 1 sampai Phase 4, dengan acceptance scenario Bagian 8 sebagai target pengujian.
