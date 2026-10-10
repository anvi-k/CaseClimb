"""Build the locked, Linux arm64 Lambda archive without private source files."""

import shutil
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    build = ROOT / ".private" / "lambda-build"
    if build.exists():
        shutil.rmtree(build)
    build.mkdir(parents=True)
    requirements = build.parent / "lambda-requirements.txt"
    subprocess.run(["uv", "export", "--frozen", "--no-dev", "--no-emit-project", "--format", "requirements-txt", "--output-file", str(requirements)], cwd=ROOT, check=True, capture_output=True)
    subprocess.run(["uv", "pip", "install", "--python-platform", "aarch64-manylinux2014", "--python-version", "3.12", "--only-binary", ":all:", "--target", str(build), "-r", str(requirements)], cwd=ROOT, check=True, capture_output=True)
    for folder in ("backend", "frontend"):
        shutil.copytree(ROOT / folder, build / folder, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.md", "demo-case.json"))
    archive = build.parent / "caseclimb-lambda.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
        for source in sorted(build.rglob("*")):
            if source.is_file() and "__pycache__" not in source.parts and source.suffix != ".pyc":
                output.write(source, source.relative_to(build))
    print(f"Built {archive.name}: {archive.stat().st_size:,} bytes. Private files excluded.")


if __name__ == "__main__":
    main()
