# Sales Time Series Analytics — versi GitHub Pages

Versi statis dari dashboard Streamlit. Bedanya:

| Streamlit (lama) | GitHub Pages (baru) |
|---|---|
| Server Python menghitung ulang clustering setiap kali tombol diklik | Semua hasil **dihitung sekali** di laptop, website cukup membaca file JSON |
| Unduh matriks jarak 121 MB setiap cold-start | Website hanya memuat ±150 KB per matriks yang dipilih (total data ±3 MB) |
| App "tidur" jika tidak dibuka beberapa hari | Selalu aktif, gratis, cepat (CDN GitHub) |

## Struktur folder

```
sales-clustering-web/
├─ build/
│  ├─ build_data.py          ← script pra-komputasi (Python)
│  ├─ requirements-build.txt
│  └─ input/                 ← taruh dataset & npz di sini (tidak di-push)
├─ docs/                     ← INI yang dipublikasikan GitHub Pages
│  ├─ index.html
│  ├─ assets/css/style.css
│  ├─ assets/js/app.js
│  └─ data/                  ← hasil build_data.py (JSON)
├─ .gitignore
└─ README.md
```

---

## Tahap 1 — Yang perlu di-download / di-install

1. **Python** (sudah ada: Anaconda di `C:\Users\ASUS\anaconda3`).
2. **tslearn** untuk K-Means DBA (paket lain sudah ada di Anaconda):
   ```bash
   C:\Users\ASUS\anaconda3\python.exe -m pip install tslearn
   ```
3. **Git** atau **GitHub Desktop** (pilih salah satu, GitHub Desktop paling mudah):
   - GitHub Desktop: https://desktop.github.com
   - Git: https://git-scm.com/download/win
4. **VS Code** (opsional, untuk mengedit teks/tampilan): https://code.visualstudio.com

Website-nya sendiri tidak butuh install apa pun: ECharts dan font dimuat dari CDN.

## Tahap 2 — Siapkan input

Script mencari file secara otomatis di lokasi berikut:

- `Sales transaction data.xlsx` → `build/input/` atau root proyek
- `all_distance_matrices.npz` → root proyek atau `build/input/`

Kedua file ini **tidak** ikut di-upload (sudah diatur di `.gitignore`).

## Tahap 3 — Generate data JSON

Buka **Anaconda Prompt**, lalu:

```bash
cd /d D:\Claude\sales-clustering-web
python build/build_data.py
```

- Proses pertama ±5–40 menit (MDS 27 matriks + K-Means DBA 18 matriks × K 2–10).
- Hasil MDS & DBA disimpan di `build/.cache`, jadi build ulang jauh lebih cepat.
- Mau cepat tanpa DBA? `python build/build_data.py --skip-dba`
- Mau tes satu matriks saja? `python build/build_data.py --only DTW_Original`

Yang dihitung (sama dengan notebook):

| Algoritma | Matriks | Parameter |
|---|---|---|
| K-Means DBA | DTW, CDTW (R2/3/5), DDTW × 3 representasi | K = 2–10 |
| K-Medoids | 27 matriks | K = 2–10 |
| Hierarchical | 27 matriks | average & complete, K = 2–10 |
| DBSCAN | 27 matriks | min_samples 5/10/15 × eps persentil 50–95 |

## Tahap 4 — Coba di laptop

> Jangan buka `index.html` dengan klik ganda: browser memblokir `fetch` file lokal.

```bash
python -m http.server 8000 --directory docs
```

Buka http://localhost:8000

## Tahap 5 — Publikasi ke GitHub Pages

### Cara A — GitHub Desktop (disarankan)
1. Buat repository baru di github.com, mis. `sales-clustering-web` (Public).
2. GitHub Desktop → **File › Add local repository** → pilih folder `sales-clustering-web` → *create a repository* bila diminta.
3. Tulis pesan commit → **Commit to main** → **Publish repository / Push origin**.
4. Di github.com: **Settings › Pages** → *Source: Deploy from a branch* → Branch **main**, folder **/docs** → **Save**.
5. Tunggu 1–2 menit. Website tersedia di `https://<username>.github.io/sales-clustering-web/`

### Cara B — Git command line
```bash
cd /d D:\Claude\sales-clustering-web
git init
git add .
git commit -m "Dashboard clustering versi GitHub Pages"
git branch -M main
git remote add origin https://github.com/<username>/sales-clustering-web.git
git push -u origin main
```
Lalu lakukan langkah 4 di Cara A.

### Cara C — Tanpa install apa pun
Di repository GitHub: **Add file › Upload files** → seret isi folder `docs` (beserta subfoldernya) ke dalam folder `docs/` repository. Batas 100 file per upload; data kita ±30 file, jadi aman.

### Memperbarui website
Ubah kode/data → jalankan ulang `build_data.py` bila perlu → commit & push. GitHub Pages otomatis memperbarui dalam 1–2 menit.

## Kustomisasi cepat

| Ingin mengubah | Lokasi |
|---|---|
| Warna tema | `docs/assets/css/style.css` → blok `:root` |
| Teks section & panduan | `docs/index.html` |
| Narasi interpretasi & rekomendasi cluster | `docs/assets/js/app.js` → `PERSONA`, `profileCluster`, `narrative` |
| Ambang kategori (tren ±15%, CV 0,6, dsb.) | `docs/assets/js/app.js` → `profileCluster` |
| Warna cluster | `docs/assets/js/app.js` → `PALETTE` |

## Catatan metodologi

- **K-Medoids**: bila `scikit-learn-extra` terpasang dipakai PAM dari library tersebut (sama dengan notebook); bila tidak, dipakai fungsi `kmedoids_pam` yang sama persis dengan `app.py` Streamlit. Implementasi yang dipakai tercantum di footer website.
- **DBI & CHI** dihitung pada embedding MDS 5 dimensi; **Silhouette** langsung dari matriks jarak; **peta kemiripan** adalah proyeksi PCA 2D dari MDS tersebut.
- Label cluster diurutkan dari cluster terbesar (Cluster 1) ke terkecil.
- Ranking global = rata-rata ranking SI (↑), CHI (↑), DBI (↓) dengan bobot sama, sama dengan notebook.
