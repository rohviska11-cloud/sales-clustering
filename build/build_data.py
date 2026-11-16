# build_data.py
# -----------------------------------------------------------------------------
# Pra-komputasi seluruh hasil clustering agar website GitHub Pages (statis)
# tidak perlu menjalankan Python sama sekali. Jalankan SEKALI di laptop,
# lalu unggah folder docs/ ke GitHub.
#
#   python build/build_data.py \
#       --data "build/input/Sales transaction data.xlsx" \
#       --npz  "build/input/all_distance_matrices.npz"
#
# Output:
#   docs/data/base.json            -> kode produk, data mingguan, MinMax
#   docs/data/m/<MATRIKS>.json     -> hasil semua algoritma untuk 1 matriks
#   docs/data/ranking.json         -> ranking global semua kombinasi valid
#   docs/data/manifest.json        -> daftar matriks + info build
#
# Cache MDS & K-Means DBA disimpan di build/.cache agar build ulang cepat.
# -----------------------------------------------------------------------------
import argparse
import json
import time
import warnings
import urllib.request
import urllib.error
import zipfile
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.cluster.hierarchy import cut_tree, linkage
from scipy.spatial.distance import squareform
from sklearn.cluster import DBSCAN
from sklearn.decomposition import PCA
from sklearn.manifold import MDS
from sklearn.metrics import calinski_harabasz_score, davies_bouldin_score, silhouette_score

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data"
CACHE = ROOT / "build" / ".cache"
RANDOM_STATE = 42
K_VALUES = list(range(2, 11))
DBSCAN_MIN_SAMPLES = [5, 10, 15]
DBSCAN_PERCENTILES = [50, 60, 70, 80, 90, 95]
WEEKS = [f"W{i}" for i in range(52)]
NORM = [f"Normalized {i}" for i in range(52)]

try:
    from tslearn.clustering import TimeSeriesKMeans
    HAS_TSLEARN = True
except ImportError:
    HAS_TSLEARN = False

try:
    from sklearn_extra.cluster import KMedoids
    HAS_SKEXTRA = True
except ImportError:
    HAS_SKEXTRA = False




# GitHub Release: file matriks besar disimpan di Release, bukan repository.
GITHUB_OWNER = "rohviska11-cloud"
GITHUB_REPO = "sales-clustering"
GITHUB_TAG = "v1.0.0"
NPZ_ASSET_NAME = "all_distance_matrices.npz"


def download_npz_from_release(destination, owner=GITHUB_OWNER, repo=GITHUB_REPO,
                              tag=GITHUB_TAG, asset_name=NPZ_ASSET_NAME,
                              force=False):
    """
    Unduh NPZ dari GitHub Release berdasarkan nama asset.
    Menggunakan GitHub API untuk mengambil URL asset yang benar, sehingga
    tidak perlu menebak URL browser_download_url secara manual.
    """
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)

    if destination.exists() and not force:
        print(f"[OK] Matriks lokal ditemukan: {destination}")
        return destination

    api_url = (
        f"https://api.github.com/repos/{owner}/{repo}/releases/tags/{tag}"
    )
    request = urllib.request.Request(
        api_url,
        headers={
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "sales-clustering-build-script",
        },
    )

    print(f"[INFO] Memeriksa GitHub Release {owner}/{repo}@{tag} ...")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            release = json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise RuntimeError(
            "Tidak dapat membaca metadata GitHub Release. "
            "Periksa koneksi internet, nama repository, dan tag Release."
        ) from exc

    assets = release.get("assets", [])
    asset = next((a for a in assets if a.get("name") == asset_name), None)
    if asset is None:
        available = [a.get("name", "(tanpa nama)") for a in assets]
        raise FileNotFoundError(
            f"Asset '{asset_name}' tidak ditemukan pada Release {tag}. "
            f"Asset yang tersedia: {available}. "
            "Periksa NPZ_ASSET_NAME di bagian konfigurasi script."
        )

    download_url = asset.get("browser_download_url")
    if not download_url:
        raise RuntimeError("GitHub Release tidak menyediakan URL unduhan asset.")

    temp_path = destination.with_name(destination.name + ".part")
    expected_size = asset.get("size")
    print(f"[INFO] Mengunduh {asset_name} ({(expected_size or 0) / 1024**2:.1f} MB) ...")

    try:
        req = urllib.request.Request(
            download_url,
            headers={"User-Agent": "sales-clustering-build-script"},
        )
        with urllib.request.urlopen(req, timeout=120) as response, open(temp_path, "wb") as out:
            total = int(response.headers.get("Content-Length") or expected_size or 0)
            downloaded = 0
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
                downloaded += len(chunk)
                if total:
                    percent = downloaded * 100 / total
                    print(
                        f"\\r[DOWNLOAD] {downloaded / 1024**2:.1f} / "
                        f"{total / 1024**2:.1f} MB ({percent:5.1f}%)",
                        end="",
                        flush=True,
                    )
            print()

        if not temp_path.exists() or temp_path.stat().st_size == 0:
            raise RuntimeError("File hasil unduhan kosong.")
        if expected_size and temp_path.stat().st_size != expected_size:
            raise RuntimeError(
                f"Ukuran file tidak sesuai. Diterima {temp_path.stat().st_size} "
                f"bytes, seharusnya {expected_size} bytes."
            )
        if not zipfile.is_zipfile(temp_path):
            raise RuntimeError(
                "File unduhan bukan arsip NPZ/ZIP yang valid. "
                "Kemungkinan URL asset atau proses unduhan bermasalah."
            )

        # Pastikan arsip dapat dibaca NumPy sebelum mengganti file tujuan.
        with np.load(temp_path, allow_pickle=False) as check:
            if not check.files:
                raise RuntimeError("NPZ valid secara ZIP tetapi tidak berisi array.")

        temp_path.replace(destination)
        print(f"[OK] NPZ berhasil disimpan: {destination}")
        return destination

    except Exception:
        if temp_path.exists():
            temp_path.unlink()
        raise



# ----------------------------------------------------------------------------- utils
def r(x, nd=4):
    """Bulatkan & ubah NaN -> None supaya JSON valid."""
    if x is None:
        return None
    x = float(x)
    return None if not np.isfinite(x) else round(x, nd)


def derivative_ts(A):
    A = np.asarray(A, dtype=float)
    out = np.zeros_like(A)
    out[:, 0] = A[:, 1] - A[:, 0]
    for t in range(1, A.shape[1] - 1):
        out[:, t] = 0.5 * (A[:, t] - A[:, t - 1]) + 0.25 * (A[:, t + 1] - A[:, t - 1])
    out[:, -1] = A[:, -1] - A[:, -2]
    return out


def parse_key(key):
    """DTW_Original | CDTW_MinMax_R2 | DDTW_Scaled | WDTW_Original_g0.05"""
    parts = key.split("_")
    dist, rep = parts[0], parts[1]
    param = None
    if dist == "CDTW":
        param = int(parts[2][1:])
    elif dist == "WDTW":
        param = float(parts[2][1:])
    return dist, rep, param


def balance_score(labels):
    y = np.asarray(labels)
    y = y[y != -1]
    vals, counts = np.unique(y, return_counts=True)
    if len(vals) <= 1:
        return 0.0
    p = counts / counts.sum()
    return float(-(p * np.log(p)).sum() / np.log(len(vals)))


def evaluate(D, coords5, labels):
    labels = np.asarray(labels)
    keep = labels != -1
    y = labels[keep]
    uniq = np.unique(y)
    si = dbi = chi = np.nan
    if 2 <= len(uniq) < len(y):
        si = silhouette_score(D[np.ix_(keep, keep)], y, metric="precomputed")
        dbi = davies_bouldin_score(coords5[keep], y)
        chi = calinski_harabasz_score(coords5[keep], y)
    return {
        "si": r(si), "dbi": r(dbi), "chi": r(chi, 2),
        "bs": r(balance_score(labels)), "ncl": int(len(uniq)),
        "noise": r((labels == -1).mean() * 100, 2),
    }


def relabel(labels):
    """Urutkan ulang label: cluster terbesar = 0, noise tetap -1."""
    labels = np.asarray(labels, dtype=int)
    ids = [c for c in np.unique(labels) if c != -1]
    ids.sort(key=lambda c: -(labels == c).sum())
    mapping = {old: new for new, old in enumerate(ids)}
    mapping[-1] = -1
    return np.array([mapping[v] for v in labels], dtype=int), mapping


def medoid_of(D, members):
    if len(members) == 1:
        return int(members[0])
    block = D[np.ix_(members, members)]
    return int(members[np.argmin(block.sum(axis=1))])


def kmedoids_simple(D, k, seed=RANDOM_STATE, max_iter=100):
    """Sama persis dengan fungsi kmedoids_pam di app.py Streamlit."""
    n = len(D)
    rng = np.random.default_rng(seed)
    medoids = [int(rng.integers(n))]
    while len(medoids) < k:
        nearest = np.min(D[:, medoids], axis=1)
        weights = nearest ** 2
        weights[medoids] = 0
        if weights.sum() <= 0:
            medoids.append(int(rng.choice(np.setdiff1d(np.arange(n), medoids))))
        else:
            nxt = int(rng.choice(n, p=weights / weights.sum()))
            if nxt in medoids:
                nxt = int(rng.choice(np.setdiff1d(np.arange(n), medoids)))
            medoids.append(nxt)
    medoids = np.asarray(medoids, dtype=int)
    for _ in range(max_iter):
        labels = np.argmin(D[:, medoids], axis=1)
        new = medoids.copy()
        for c in range(k):
            members = np.where(labels == c)[0]
            if len(members):
                new[c] = members[np.argmin(D[np.ix_(members, members)].sum(axis=1))]
        if np.array_equal(new, medoids):
            break
        medoids = new
    return np.argmin(D[:, medoids], axis=1)


def kmedoids(D, k):
    if HAS_SKEXTRA:
        model = KMedoids(n_clusters=k, metric="precomputed", method="pam",
                         init="k-medoids++", random_state=RANDOM_STATE)
        return model.fit_predict(D)
    return kmedoids_simple(D, k)


def get_mds(key, D):
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"mds_{key}.npy"
    if f.exists():
        return np.load(f)
    model = MDS(n_components=5, metric=True, dissimilarity="precomputed",
                random_state=RANDOM_STATE, n_init=1, max_iter=200)
    coords = model.fit_transform(D)
    np.save(f, coords)
    return coords


def get_dba(key, Xfit, k, params):
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"dba_{key}_k{k}.npz"
    if f.exists():
        z = np.load(f)
        return z["labels"], z["centers"], float(z["t"])
    t0 = time.perf_counter()
    model = TimeSeriesKMeans(n_clusters=k, metric="dtw", metric_params=params,
                             max_iter=10, max_iter_barycenter=10, n_init=2,
                             n_jobs=-1, random_state=RANDOM_STATE, verbose=False)
    labels = model.fit_predict(Xfit[:, :, None])
    centers = model.cluster_centers_[:, :, 0]
    t = time.perf_counter() - t0
    np.savez(f, labels=labels, centers=centers, t=t)
    return labels, centers, t


# ----------------------------------------------------------------------------- main
def pack(D, coords5, labels, runtime, centers=None, extra=None):
    labels, mapping = relabel(labels)
    out = {"labels": labels.tolist(), "t": r(runtime, 3), **evaluate(D, coords5, labels)}
    reps = []
    for c in range(out["ncl"]):
        reps.append(medoid_of(D, np.where(labels == c)[0]))
    out["reps"] = reps
    if centers is not None:
        inv = {new: old for old, new in mapping.items() if old != -1}
        out["centers"] = [[r(v, 4) for v in centers[inv[c]]] for c in range(out["ncl"])]
    if extra:
        out.update(extra)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(ROOT / "build" / "input" / "Sales transaction data.xlsx"))
    default_npz = ROOT / "build" / "input" / "all_distance_matrices.npz"
    root_npz = ROOT / "all_distance_matrices.npz"
    if not default_npz.exists() and root_npz.exists():
        default_npz = root_npz
    ap.add_argument("--npz", default=str(default_npz),
                    help="Lokasi NPZ lokal; jika tidak ada akan diunduh dari GitHub Release.")
    ap.add_argument("--release-tag", default=GITHUB_TAG, help="Tag GitHub Release sumber NPZ.")
    ap.add_argument("--npz-asset", default=NPZ_ASSET_NAME, help="Nama asset NPZ pada GitHub Release.")
    ap.add_argument("--force-download", action="store_true", help="Unduh ulang NPZ meskipun file lokal sudah ada.")
    ap.add_argument("--skip-dba", action="store_true", help="Lewati K-Means DBA (paling lama)")
    ap.add_argument("--only", default=None, help="Proses satu matriks saja, mis. DTW_Original")
    args = ap.parse_args()

    use_dba = HAS_TSLEARN and not args.skip_dba
    if not HAS_TSLEARN and not args.skip_dba:
        print("[!] tslearn belum terpasang -> K-Means DBA dilewati. `pip install tslearn` untuk menyertakannya.")

    # ---------- pastikan file NPZ tersedia (otomatis unduh dari GitHub Release)
    npz_path = download_npz_from_release(
        args.npz, tag=args.release_tag, asset_name=args.npz_asset,
        force=args.force_download
    )

    # ---------- data
    path = Path(args.data)
    df = pd.read_excel(path) if path.suffix.lower() in (".xlsx", ".xls") else pd.read_csv(path)
    df = df.drop_duplicates("Product_Code").reset_index(drop=True)
    codes = df["Product_Code"].astype(str).to_numpy()
    X_raw = df[WEEKS].apply(pd.to_numeric, errors="coerce").fillna(0).to_numpy(float)
    if all(c in df.columns for c in NORM):
        X_mm = df[NORM].apply(pd.to_numeric, errors="coerce").fillna(0).to_numpy(float)
    else:
        lo, hi = X_raw.min(1, keepdims=True), X_raw.max(1, keepdims=True)
        X_mm = np.divide(X_raw - lo, hi - lo, out=np.zeros_like(X_raw), where=(hi - lo) != 0)
    # Standardisasi per produk/baris (setiap produk distandardisasi dari 52 minggu).
    # ddof=0 mengikuti rumus std() default NumPy dan standardisasi di app.js.
    row_mean = X_raw.mean(axis=1, keepdims=True)
    row_std = X_raw.std(axis=1, keepdims=True)
    row_std[row_std == 0] = 1.0
    X_sc = (X_raw - row_mean) / row_std

    X_by = {"Original": X_raw, "MinMax": X_mm, "Scaled": X_sc}

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "m").mkdir(exist_ok=True)
    base = {
        "codes": codes.tolist(),
        "weeks": WEEKS,
        "raw": X_raw.astype(int).tolist() if np.allclose(X_raw, X_raw.round()) else X_raw.round(3).tolist(),
        "minmax": X_mm.round(3).tolist(),
    }
    (OUT / "base.json").write_text(json.dumps(base, separators=(",", ":")), encoding="utf-8")
    print(f"base.json  -> {len(codes)} produk x {len(WEEKS)} minggu")

    # ---------- matriks
    archive = np.load(npz_path, allow_pickle=True)

    # Cache MDS/DBA lama tidak boleh dipakai jika file NPZ sumber berubah.
    # Ini penting ketika matriks DTW dihitung ulang dari Scaled per baris.
    CACHE.mkdir(parents=True, exist_ok=True)
    stat = Path(npz_path).stat()
    cache_signature = f"{Path(npz_path).resolve()}|{stat.st_size}|{stat.st_mtime_ns}"
    stamp_file = CACHE / "npz_source_signature.txt"
    old_signature = stamp_file.read_text(encoding="utf-8") if stamp_file.exists() else None
    if old_signature != cache_signature:
        for cache_file in CACHE.iterdir():
            if cache_file.is_file():
                cache_file.unlink()
            elif cache_file.is_dir():
                import shutil
                shutil.rmtree(cache_file)
        stamp_file.write_text(cache_signature, encoding="utf-8")
        print("[INFO] Cache MDS/DBA dibersihkan karena sumber NPZ berubah.")

    if "product_code" in archive.files:
        saved = archive["product_code"].astype(str)
        if not np.array_equal(saved, codes):
            raise SystemExit("Urutan Product_Code dataset berbeda dengan matriks NPZ.")
    keys = [k for k in archive.files if k != "product_code"]
    if args.only:
        keys = [k for k in keys if k == args.only]

    ranking, manifest = [], []
    for i, key in enumerate(keys, 1):
        t_start = time.perf_counter()
        dist, rep, param = parse_key(key)
        D = np.asarray(archive[key], dtype=float)
        if D.ndim != 2 or D.shape[0] != D.shape[1]:
            raise ValueError(f"Matriks {key} bukan matriks persegi: shape={D.shape}")
        if D.shape[0] != len(codes):
            raise ValueError(
                f"Ukuran matriks {key} ({D.shape[0]}x{D.shape[1]}) tidak sama "
                f"dengan jumlah produk dataset ({len(codes)})."
            )
        if not np.isfinite(D).all():
            raise ValueError(f"Matriks {key} mengandung NaN atau infinity.")
        D = (D + D.T) / 2
        np.fill_diagonal(D, 0)
        if np.min(D) < -1e-8:
            raise ValueError(f"Matriks {key} mengandung jarak negatif.")
        coords5 = get_mds(key, D)
        coords2 = PCA(n_components=2, random_state=RANDOM_STATE).fit_transform(coords5)
        res = {"key": key, "dist": dist, "rep": rep, "param": param,
               "xy": np.round(coords2, 3).tolist(), "runs": {}}

        def add(run_id, algo, payload, k=None, link=None, ms=None, pct=None, eps=None):
            res["runs"][run_id] = payload
            ranking.append({
                "id": run_id, "key": key, "dist": dist, "rep": rep, "param": param,
                "algo": algo, "k": k, "link": link, "ms": ms, "pct": pct, "eps": r(eps, 6),
                **{m: payload[m] for m in ("si", "dbi", "chi", "bs", "ncl", "noise", "t")},
            })

        # K-Medoids
        for k in K_VALUES:
            t0 = time.perf_counter()
            lab = kmedoids(D, k)
            add(f"PAM_k{k}", "K-Medoids PAM", pack(D, coords5, lab, time.perf_counter() - t0), k=k)

        # Hierarchical
        cond = squareform(D, checks=False)
        for link in ("average", "complete"):
            t0 = time.perf_counter()
            Z = linkage(cond, method=link)
            tfit = time.perf_counter() - t0
            for k in K_VALUES:
                lab = cut_tree(Z, n_clusters=[k]).ravel()
                add(f"HC-{link}_k{k}", f"Hierarchical {link.capitalize()}",
                    pack(D, coords5, lab, tfit), k=k, link=link)

        # DBSCAN grid (eps dari persentil jarak tetangga ke-min_samples)
        sortedD = np.sort(D, axis=1)
        for ms in DBSCAN_MIN_SAMPLES:
            kth = sortedD[:, ms]
            for pct in DBSCAN_PERCENTILES:
                eps = float(np.percentile(kth, pct))
                t0 = time.perf_counter()
                lab = DBSCAN(eps=max(eps, 1e-12), min_samples=ms, metric="precomputed").fit_predict(D)
                add(f"DBSCAN_ms{ms}_p{pct}", "DBSCAN",
                    pack(D, coords5, lab, time.perf_counter() - t0, extra={"eps": r(eps, 6)}),
                    ms=ms, pct=pct, eps=eps)

        # K-Means DBA (tidak untuk WDTW)
        if use_dba and dist != "WDTW":
            Xfit = derivative_ts(X_by[rep]) if dist == "DDTW" else X_by[rep]
            params = {"global_constraint": "sakoe_chiba", "sakoe_chiba_radius": param} if dist == "CDTW" else {}
            for k in K_VALUES:
                lab, centers, t = get_dba(key, Xfit, k, params)
                add(f"DBA_k{k}", "K-Means DBA", pack(D, coords5, lab, t, centers=centers), k=k)

        (OUT / "m" / f"{key}.json").write_text(json.dumps(res, separators=(",", ":")), encoding="utf-8")
        manifest.append({"key": key, "dist": dist, "rep": rep, "param": param,
                         "dba": bool(use_dba and dist != "WDTW")})
        print(f"[{i:02d}/{len(keys)}] {key:<24} {len(res['runs'])} model  {time.perf_counter()-t_start:6.1f}s")

    # ---------- ranking global (sama dengan notebook: rata-rata rank SI, CHI, DBI)
    rk = pd.DataFrame(ranking)
    valid = rk.dropna(subset=["si", "chi", "dbi"]).copy()
    valid["r_si"] = valid["si"].rank(ascending=False, method="average")
    valid["r_chi"] = valid["chi"].rank(ascending=False, method="average")
    valid["r_dbi"] = valid["dbi"].rank(ascending=True, method="average")
    valid["score"] = valid[["r_si", "r_chi", "r_dbi"]].mean(axis=1).round(2)
    valid["rank"] = valid["score"].rank(method="min").astype(int)
    valid = valid.sort_values("rank").drop(columns=["r_si", "r_chi", "r_dbi"])
    valid = valid.astype(object).where(pd.notna(valid), None)

    if not args.only:
        (OUT / "ranking.json").write_text(
            json.dumps(valid.to_dict(orient="records"), separators=(",", ":")), encoding="utf-8")
        (OUT / "manifest.json").write_text(json.dumps({
            "built": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "n_products": int(len(codes)), "n_models": int(len(rk)), "n_valid": int(len(valid)),
            "dba": use_dba, "kmedoids_impl": "sklearn_extra PAM" if HAS_SKEXTRA else "k-medoids (alternate, sama dengan app.py)",
            "matrices": manifest,
        }, indent=1), encoding="utf-8")
    print(f"Selesai: {len(rk)} model, {len(valid)} valid. Output -> {OUT}")
    archive.close()


if __name__ == "__main__":
    main()
