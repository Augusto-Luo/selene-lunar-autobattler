"""Create a curated source ZIP using only the Python standard library."""

from hashlib import sha256
from pathlib import Path, PurePosixPath
import re
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parent.parent
PREFIX = "selene-lunar-autobattler"
OUTPUT = ROOT / "selene-github-source.zip"
ROOT_FILES = (
    ".gitattributes", ".gitignore", ".nvmrc", "README.md", "README.zh-CN.md",
    "THIRD_PARTY_NOTICES.md", "index.html", "package.json", "package-lock.json",
    "tsconfig.json", "vite.config.ts", "启动试玩.command",
)
DIRECTORIES = {
    "src": {".ts", ".css"},
    "tests": {".ts"},
    "scripts": {".mjs", ".ts", ".py"},
    "docs": {".md", ".json", ".txt"},
    "art-direction/map-differentiation": {".png", ".json"},
}
TEXT_SUFFIXES = {".ts", ".css", ".mjs", ".py", ".md", ".json", ".txt", ".html", ".command"}


def public_copy(path: Path) -> bytes:
    """Remove workstation paths from prose and historical check logs."""
    data = path.read_bytes()
    if path.suffix in {".md", ".txt", ".json"}:
        text = data.decode("utf-8")
        text = re.sub(r"/private/tmp/[\w./-]+", "[local verification workspace]", text)
        text = re.sub(r"/Users/[^/\s`]+/[^\s`\"<>]*", "[local project workspace]", text)
        data = text.encode("utf-8")
    return data


def collect() -> dict[str, bytes]:
    paths = [ROOT / name for name in ROOT_FILES]
    for name, extensions in DIRECTORIES.items():
        directory = ROOT / name
        if not directory.is_dir():
            raise RuntimeError(f"Missing source directory: {name}")
        paths.extend(path for path in directory.rglob("*") if path.is_file()
                     and path.suffix in extensions
                     and not any(part.startswith(".") or part == "__pycache__"
                                 for part in path.relative_to(directory).parts))
    files = {}
    for path in sorted(set(paths)):
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(ROOT):
            raise RuntimeError(f"Unsafe or missing release file: {path.name}")
        name = path.relative_to(ROOT).as_posix()
        data = public_copy(path)
        if path.suffix in TEXT_SUFFIXES:
            text = data.decode("utf-8")
            if re.search(r"/Users/[A-Za-z0-9_.-]+/|/private/tmp/[A-Za-z0-9_.-]+|/var/folders/[A-Za-z0-9_.-]+", text):
                raise RuntimeError(f"Workstation path remains in {name}")
        files[name] = data
    # A source checkout must never depend on generated files to explain how it builds.
    for name, data in files.items():
        if not name.endswith(".md"):
            continue
        for target in re.findall(r"\]\(([^)]+)\)", data.decode("utf-8")):
            target = target.split("#", 1)[0]
            if not target or re.match(r"[A-Za-z][\w+.-]*:", target):
                continue
            path = (ROOT / PurePosixPath(name).parent / target).resolve()
            if not path.is_relative_to(ROOT) or path.relative_to(ROOT).as_posix() not in files:
                raise RuntimeError(f"Missing release documentation link in {name}: {target}")
    return files


def main() -> None:
    files = collect()
    manifest = "".join(f"{sha256(data).hexdigest()}  {name}\n" for name, data in sorted(files.items()))
    files["SOURCE-MANIFEST.sha256"] = manifest.encode("utf-8")
    with ZipFile(OUTPUT, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(files.items()):
            # Stable ZIP metadata makes unchanged source produce the same checksum.
            info = ZipInfo(f"{PREFIX}/{name}", date_time=(2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (0o100755 if name.endswith(".command") else 0o100644) << 16
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, data, compresslevel=9)
    with ZipFile(OUTPUT) as archive:
        if archive.testzip() is not None or len(archive.namelist()) != len(files):
            raise RuntimeError("Source ZIP verification failed")
    digest = sha256(OUTPUT.read_bytes()).hexdigest()
    OUTPUT.with_suffix(".zip.sha256").write_text(f"{digest}  {OUTPUT.name}\n", encoding="utf-8")
    print(f"Source ZIP: {OUTPUT.name} ({len(files)} files, {OUTPUT.stat().st_size:,} bytes)")
    print(f"SHA-256: {digest}")


if __name__ == "__main__":
    main()
