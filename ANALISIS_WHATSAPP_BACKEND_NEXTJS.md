# Analisis Backend WhatsApp dengan Next.js

## Tujuan dan batas pekerjaan

Dokumen ini menjadi acuan backend terpisah menggunakan Next.js. Frontend OCC yang sekarang tetap dipakai; backend Next.js menyediakan API yang dapat dipanggil halaman WhatsApp di aplikasi tersebut. Implementasi awal API dan worker baca-saja kini berada di workspace ini.

Ruang lingkup backend yang direncanakan:

- Menyediakan koneksi/status QR WhatsApp dan proses baca riwayat.
- Menyimpan percakapan dan pesan ke tabel Supabase yang sudah tersedia.
- Menyediakan API untuk mengambil daftar percakapan serta pesan.
- Mendukung pencarian nomor dan teks/ID yang terkandung di pesan.
- Tidak menyediakan endpoint, tombol, ataupun fungsi untuk mengirim atau membalas pesan WhatsApp.
- Tidak menerima impor file. Ekspor Excel tetap menjadi urusan frontend yang mengunduh data melalui API.

Halaman WhatsApp di aplikasi OCC masih placeholder **Under Construction**. Implementasi backend tidak mengubah halaman itu atau membuat proxy PHP, karena kode OCC tidak tersedia di workspace ini.

## Temuan dari aplikasi OCC

- Frontend OCC berada di `public/`, dengan endpoint aplikasi yang ada di `public/api/`.
- Login aplikasi sekarang menggunakan session PHP. Frontend memeriksa sesi melalui `auth-check.php` dan browser mengirim cookie same-origin.
- Role `super_admin` ditentukan di backend PHP dengan `role_id = 1`. Pembatasan role di JavaScript hanya untuk tampilan; bukan pengganti otorisasi server.
- Pola koneksi Supabase yang dipakai PHP berada di `public/api/config-supabase.php` dan `public/api/supabase-http.php`:
  - URL proyek Supabase dan key server dibaca dari konfigurasi PHP.
  - Permintaan REST dikirim ke Supabase PostgREST.
  - Header `apikey` dan `Authorization: Bearer ...` dikirim dari server.
  - Kredensial tidak dikirim ke browser.
- Tabel `wa_conversations`, `wa_messages`, dan `wa_import_batches` sudah tersedia. Skema dan kebijakan tabel dijelaskan di `SUPABASE_WHATSAPP_HISTORY.sql`. Fitur baca WhatsApp tidak memerlukan tabel batch impor.
- Implementasi worker di workspace ini memakai `whatsapp-web.js` dan LocalAuth dengan direktori sesi persisten. Jangan mengandalkan browser frontend untuk membaca WhatsApp Web.

## Rancangan arsitektur

```text
Browser OCC (frontend yang ada)
  ├─ autentikasi melalui session PHP yang ada
  └─ API same-origin / proxy OCC
       └─ backend Next.js (API saja)
            ├─ validasi otorisasi superadmin
            ├─ Supabase PostgREST, memakai key server
            └─ worker WhatsApp Web persisten
                 ├─ QR dan sesi tertaut
                 └─ baca/sinkronisasi pesan
```

### Batas autentikasi lintas origin

Session PHP yang ada tidak otomatis dapat dibaca oleh backend Next.js di domain Firebase/host lain. Menambahkan CORS tidak memindahkan atau memvalidasi session tersebut. Jangan mempercayai `role=super_admin` yang dikirim oleh JavaScript dan jangan menaruh secret bersama di frontend.

Pilihan integrasi:

1. **Disarankan untuk mempertahankan login OCC tanpa perubahan besar:** browser memanggil PHP OCC pada origin yang sama; endpoint PHP memvalidasi session dan `role_id = 1`, lalu meneruskan permintaan ke Next.js memakai token server-ke-server dari konfigurasi environment. Next.js juga memvalidasi token tersebut sebelum menjalankan operasi yang diminta. Ini menghindari mengekspos token backend dan tidak perlu membuka akses Supabase ke browser.
2. **Panggilan browser langsung ke Next.js:** hanya jika tersedia token identitas yang dapat diverifikasi oleh Next.js (misalnya Firebase Auth ID token yang memang sudah digunakan oleh login OCC). Backend wajib memverifikasi tanda tangan/audience/issuer dan role dari sumber tepercaya. Session PHP saat ini tidak dapat dipakai langsung untuk opsi ini.

Opsi 1 cocok dengan login dan proteksi API OCC saat ini. Endpoint PHP yang bertindak sebagai proxy tetap server-side; Next.js adalah backend WhatsApp/Supabase terpisah.

### URL browser dan CORS

Jika browser hanya memanggil PHP proxy, permintaan tetap same-origin dan CORS untuk Next.js tidak diperlukan. PHP menghubungi Next.js dari server.

Jika kemudian diputuskan browser memanggil Next.js secara langsung:

- Aktifkan CORS hanya untuk origin produksi OCC dan origin lokal development yang diperlukan; jangan gunakan wildcard bersama credentials.
- Gunakan HTTPS.
- Validasi token autentikasi pada setiap route privat.
- CORS bukan kontrol autentikasi.

## Koneksi Supabase

### Samakan dengan integrasi OCC

Backend Next.js menggunakan URL proyek dan **key server yang sama kelas/tujuannya dengan konfigurasi server OCC saat ini**, tetapi nilainya dimasukkan ke environment backend Next.js—bukan disalin ke file publik atau bundle frontend.

Pola yang setara dengan `supabase-http.php`:

1. Bentuk URL REST: `${SUPABASE_URL}/rest/v1/<table>?<query>`.
2. Kirim header `apikey: <server key>`.
3. Kirim header `Authorization: Bearer <server key>`.
4. Kirim/terima JSON dan periksa status HTTP sebelum menyatakan operasi berhasil.
5. Catat error teknis di log server, tetapi jangan mengembalikan key atau header rahasia ke pemanggil.

Pilihan implementasi adalah memakai `fetch` ke PostgREST secara langsung agar pola request serupa PHP saat ini, atau memakai `@supabase/supabase-js` server-side yang dikonfigurasi dari environment. Jangan mencampur kedua pola tanpa kebutuhan. Jika memakai library, matikan penyimpanan sesi browser/persistensi auth pada client server.

Nama environment variable yang disarankan:

```text
SUPABASE_URL
SUPABASE_KEY
OCC_BACKEND_SHARED_SECRET
OCC_ALLOWED_ORIGIN          # hanya bila browser mengakses Next.js langsung
WA_HISTORY_AUTH_PATH        # direktori sesi WhatsApp persisten
WA_HISTORY_CALLBACK_SECRET  # bila worker mengirim callback internal
```

`SUPABASE_KEY` hanya dibaca oleh runtime backend dan mengikuti nama variabel yang dipakai konfigurasi server OCC. Backend ini juga menerima `SUPABASE_SERVICE_ROLE_KEY` sebagai nama alternatif. Pastikan variable tidak memakai prefix publik seperti `NEXT_PUBLIC_`, tidak ditulis ke log, tidak dikirim dalam JSON, dan tidak pernah dimasukkan ke source control. Dengan key server, akses melewati kebijakan RLS; karena itu setiap endpoint harus membatasi input dan otorisasi sebelum query.

Untuk menghindari perlunya duplikasi secret, deployment dapat mengisi environment dari secret manager Firebase/hosting yang dipilih. Nilai rahasia jangan diletakkan pada HTML, JavaScript browser, dokumentasi, atau konfigurasi yang diunggah ke direktori publik.

## Struktur route API yang disarankan

Semua route privat di bawah ini harus memvalidasi token server-ke-server dari PHP proxy atau token identitas tepercaya yang diverifikasi secara kriptografis.

| Method | Route | Kegunaan |
|---|---|---|
| `GET` | `/api/wa/status` | Mengambil status koneksi dan QR bila belum tertaut |
| `POST` | `/api/wa/connect` | Memulai/memulihkan client WhatsApp Web |
| `POST` | `/api/wa/disconnect` | Memutus sesi lokal atas permintaan superadmin |
| `GET` | `/api/wa/conversations` | Mengambil percakapan, urut `last_message_at` terbaru |
| `GET` | `/api/wa/conversations/:id/messages` | Mengambil pesan secara kronologis, dengan pagination |
| `GET` | `/api/wa/messages` | Mencari pesan dan ID eksternal secara global, dengan pagination |
| `POST` | `/api/internal/wa/sync` | Endpoint internal untuk menerima batch pesan dari worker |

Tidak boleh ada route `/send`, `/reply`, atau operasi lain yang mengirim pesan. Route internal sinkronisasi hanya boleh diakses oleh worker tervalidasi; jangan menampilkan tokennya ke browser.

### Bentuk respons API (usulan)

```json
{
  "success": true,
  "data": [],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "hasMore": false
  }
}
```

Error harus memakai status HTTP sesuai kondisi (misalnya `400`, `401`, `403`, `404`, `502`) dan pesan aman yang tidak membocorkan kredensial atau respons internal berisi secret.

## Penyimpanan dan sinkronisasi

Gunakan tabel yang sudah tersedia tanpa membuat skema relasi baru:

- `wa_conversations`: satu percakapan per nomor WhatsApp yang dinormalisasi.
- `wa_messages`: pesan masuk/keluar dengan `conversation_id`, timestamp, arah, pengirim, isi, source, external ID, dan metadata.
- `wa_import_batches`: tidak dipakai karena fitur yang diminta bukan impor.

Alur penyimpanan:

1. Worker membaca chat yang dapat diakses dari akun WhatsApp tertaut.
2. Normalisasi nomor dan timestamp, pertahankan ID pesan sumber untuk pemeriksaan duplikasi.
3. Cari percakapan berdasarkan `phone_number`. Buat bila belum ada; backend mengelola hubungan `conversation_id` secara manual sesuai skema yang ada.
4. Tolak atau abaikan duplikat berdasarkan `source` dan `external_id`, bukan hanya isi pesan.
5. Simpan pesan dan perbarui `last_message_at` percakapan bila timestamp pesan lebih baru.
6. Sinkronisasi pesan baru harus aman untuk retry; batch yang dikirim ulang tidak membuat duplikasi.
7. Jangan menghilangkan pesan media/sistem diam-diam. Simpan placeholder/metadata sesuai kemampuan integrasi dan dokumentasikan batas pembacaannya.

Tabel telah dibuat tanpa foreign key dan indeks tambahan. Jangan menambahkan asumsi constraint yang tidak ada; semua pencarian/relasi perlu memakai kolom yang tersedia dan menangani record yang tidak lengkap dengan error yang jelas.

## WhatsApp Web dan deployment Firebase

Library WhatsApp Web yang dipakai pada implementasi sebelumnya bukan API resmi WhatsApp. Kompatibilitas, format history yang dapat dibaca, dan kebijakan WhatsApp dapat berubah. Gunakan hanya pada akun yang berhak ditautkan dan lindungi data sesi.

Integrasi QR membutuhkan proses Node.js yang dapat menjalankan Chromium/Puppeteer. Ini bukan fungsi yang bisa berjalan di JavaScript frontend atau PHP-only hosting. Selain route HTTP Next.js, proses WhatsApp perlu mempertahankan client aktif dan direktori sesi autentikasi.

Sebelum menetapkan Firebase sebagai host, pastikan tipe hosting yang tersedia:

- Firebase Hosting statis saja tidak menjalankan server Next.js maupun Chromium.
- Next.js perlu runtime server, misalnya Firebase App Hosting atau layanan Node yang mendukung Next.js.
- Runtime serverless/scale-to-zero, filesystem sementara, pembatasan Chromium, atau instance yang dapat dihentikan dapat membuat sesi WhatsApp dan koneksi QR terputus. Session WhatsApp harus disimpan pada storage persisten yang aman dan worker harus dapat pulih setelah restart.
- Bila runtime Firebase yang dipilih tidak menjamin proses Node/Chromium dan storage persisten, pisahkan worker WhatsApp ke host Node/VPS yang selalu aktif. Next.js tetap dapat menyediakan API aplikasi, atau API dan worker dijalankan pada service Node persisten yang sama.

Jangan menganggap Next.js API route otomatis cocok untuk proses WhatsApp jangka panjang. Uji start, QR, scan, reconnect setelah restart, dan penyimpanan sesi pada target hosting sebenarnya sebelum integrasi dianggap selesai.

## Keamanan minimum

- Wajibkan superadmin pada setiap operasi yang mengakses data WhatsApp; validasi dilakukan di server.
- PHP proxy memvalidasi session OCC dan `role_id = 1` sebelum meneruskan request.
- Next.js memvalidasi shared secret antarserver untuk semua request yang diteruskan PHP. Gunakan nilai acak kuat, rotasi bila bocor, dan bandingkan dengan metode constant-time.
- Route callback/sinkronisasi worker harus memiliki autentikasi sendiri, batas ukuran/batch, validasi tipe data, dan rate limit.
- Simpan Supabase server key, shared secret, serta direktori sesi WhatsApp sebagai secret/private data; jangan pernah mengeksposnya ke browser atau log.
- Aktifkan RLS seperti yang sudah didefinisikan di SQL. Jangan menambah policy publik hanya untuk mengatasi error koneksi server.
- Batasi CORS jika browser langsung mengakses API eksternal.
- Jangan mencatat isi QR, token, cookie, atau data sensitif pesan ke log.
- Gunakan pagination dan batas ukuran query agar pencarian/ekspor tidak menarik seluruh tabel sekaligus.

## Status dan pekerjaan integrasi tersisa

1. Deploy pada satu host Node persisten dengan Chromium/Puppeteer sandbox dan storage sesi persisten.
2. Isi secret runtime melalui secret manager/environment; jangan commit `.env.local`.
3. Buat PHP proxy OCC yang memvalidasi session dan `role_id = 1`, lalu mengirim `x-occ-backend-secret`.
4. Hubungkan halaman WhatsApp OCC ke proxy setelah uji QR, reconnect, sinkronisasi, pagination, dan hak akses di host deployment.
5. Pertahankan akses superadmin dan pastikan tidak ada fitur kirim/balas.

## Kriteria penerimaan

- Browser OCC tidak menerima key Supabase, shared secret, atau sesi autentikasi WhatsApp.
- Pengguna non-superadmin ditolak oleh backend, bukan sekadar menyembunyikan menu.
- QR dapat ditampilkan, ditautkan, dan pulih setelah restart sesuai kemampuan runtime hosting yang dipilih.
- Pesan tersimpan ke `wa_conversations` dan `wa_messages`; pengiriman/balasan tidak tersedia.
- Pengiriman batch berulang tidak menggandakan pesan.
- Pencarian nomor, teks, dan ID transaksi di body pesan bekerja dengan pagination.
- Pesan ditampilkan menurut waktu yang benar dan arah inbound/outbound tetap dibedakan.
- Kegagalan Supabase/WhatsApp ditampilkan sebagai error eksplisit dan dapat ditelusuri dari log aman.
