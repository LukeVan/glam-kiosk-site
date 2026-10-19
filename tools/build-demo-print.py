"""Build synthetic-demo print previews with permanent public download QR codes."""
import json
from pathlib import Path

import qrcode
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ORIGIN = "https://kiosk-preview--glam-kiosk-site--lukevan.aem.page"
catalog = json.loads((ROOT / "assets/offline-demos/catalog.json").read_text())
for person in catalog["people"]:
    slug = person["name"].lower()
    if slug not in ("tina", "sarah", "greg"):
        raise ValueError("Only approved synthetic demo people may be exported")
    destination = ROOT / "assets/demo-print" / slug
    destination.mkdir(parents=True, exist_ok=True)
    code = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=4)
    code.add_data(f"{ORIGIN}/max-download.html?demo={slug}")
    code.make(fit=True)
    qr = code.make_image(fill_color="black", back_color="white").convert("RGB")
    qr.save(destination / "qr.png", optimize=True)
    for brand, asset in person["profiles"]["max_square"]["printPreviews"].items():
        with Image.open(ROOT / asset["blob"]) as source:
            if source.size != (1800, 1200):
                raise ValueError("Print-template geometry changed; inspect QR placement")
            preview = source.convert("RGB")
            # Cover the complete original QR, preserving its white template panel.
            preview.paste(qr.resize((218, 218), Image.Resampling.NEAREST), (1260, 941))
            preview.save(destination / f"{brand}.jpg", quality=95, optimize=True)
