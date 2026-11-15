"""Bounded, local text and style extraction from project Office and UTF-8 files. No macros or formulas execute."""

import csv
import io
import posixpath
import re
import zipfile
from xml.etree import ElementTree as ET

FORMATS = {"docx", "pptx", "xlsx", "txt", "csv"}
MAX_TEXT = 1_000_000
MAX_XML = 10 * 1024 * 1024
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
X = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def chunks(text):
    if not text.strip() or "\x00" in text or len(text) > MAX_TEXT:
        raise ValueError("Gebruik een bestand met leesbare tekst en maximaal 1.000.000 tekens.")
    return [text[i : i + 10000] for i in range(0, len(text), 10000)]


def extract(data: bytes, kind: str) -> list[str]:
    if kind in {"txt", "csv"}:
        text = data.decode("utf-8-sig")
        if kind == "csv":
            # Preserve raw values (including formula-like text) without evaluating anything.
            old_limit = csv.field_size_limit(MAX_TEXT)
            try:
                try:
                    dialect = csv.Sniffer().sniff(text[:8192], delimiters=",;\t|")
                except csv.Error:
                    dialect = csv.excel
                text = "\n".join("\t".join(row) for row in csv.reader(io.StringIO(text), dialect))
            finally:
                csv.field_size_limit(old_limit)
        return chunks(text)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if len(entries) > 5000 or sum(e.file_size for e in entries) > 100 * 1024 * 1024:
            raise ValueError("Het uitgepakte Office-bestand is te groot.")
        if any(e.flag_bits & 1 for e in entries):
            raise ValueError("Gebruik een Office-bestand zonder wachtwoord.")

        names = set(archive.namelist())

        def xml(name):
            if name not in names:
                raise ValueError("Een onderdeel van het Office-bestand ontbreekt.")
            if archive.getinfo(name).file_size > MAX_XML:
                raise ValueError("Een onderdeel van het Office-bestand is te groot.")
            raw = archive.read(name)
            if b"<!entity" in raw.lower():
                raise ValueError("Externe of interne XML-entiteiten zijn niet toegestaan.")
            return ET.fromstring(raw)

        if kind == "docx":
            root = xml("word/document.xml")
            return chunks(
                "\n".join("".join(p.itertext()) if not list(p.iter(W + "t")) else "".join(t.text or "" for t in p.iter(W + "t")) for p in root.iter(W + "p"))
            )
        if kind == "pptx":
            presentation = xml("ppt/presentation.xml")
            relations = {e.attrib["Id"]: e.attrib.get("Target", "") for e in xml("ppt/_rels/presentation.xml.rels")}
            slides = []
            for e in presentation.iter("{http://schemas.openxmlformats.org/presentationml/2006/main}sldId"):
                target = relations.get(e.attrib.get(R + "id"), "").replace("\\", "/")
                if not target:
                    raise ValueError("Een slide ontbreekt.")
                slides.append(posixpath.normpath("ppt/" + target) if not target.startswith("/") else target.lstrip("/"))
            if not 1 <= len(slides) <= 200:
                raise ValueError("Gebruik een presentatie met 1 tot 200 slides.")
            themes = sorted(n for n in names if re.fullmatch(r"ppt/theme/theme\d+\.xml", n))[:5]
            style = []
            for name in themes:
                root = xml(name)
                colours = sorted({c.attrib["val"] for c in root.iter(A + "srgbClr") if "val" in c.attrib})
                fonts = sorted({f.attrib["typeface"] for f in root.iter(A + "latin") if f.attrib.get("typeface")})
                style.append(f"Thema: kleuren {', '.join('#' + c for c in colours)}; lettertypen {', '.join(fonts)}.")
            size = presentation.find("{http://schemas.openxmlformats.org/presentationml/2006/main}sldSz")
            if size is not None:
                style.append(f"Slideformaat (EMU): {size.attrib.get('cx')} × {size.attrib.get('cy')}.")
            pages = []
            for index, name in enumerate(slides, 1):
                root = xml(name)
                text = "\n".join("".join(t.text or "" for t in p.iter(A + "t")) for p in root.iter(A + "p"))
                sizes = sorted({int(r.attrib["sz"]) / 100 for r in root.iter(A + "rPr") if r.attrib.get("sz", "").isdigit()})
                layout = []
                for shape in root.iter("{http://schemas.openxmlformats.org/presentationml/2006/main}sp"):
                    transform = shape.find(".//" + A + "xfrm")
                    if transform is not None:
                        offset, extent = transform.find(A + "off"), transform.find(A + "ext")
                        if offset is not None and extent is not None:
                            label = " ".join(t.text or "" for t in shape.iter(A + "t"))[:100]
                            layout.append(f"Tekstvak {label!r} (EMU): positie {offset.attrib}; afmeting {extent.attrib}.")
                pages.append(f"Slide {index}\n" + "\n".join(style) + f"\nTekstgroottes (pt): {sizes}\n" + "\n".join(layout[:30]) + f"\n\n{text}")
            if sum(map(len, pages)) > MAX_TEXT:
                raise ValueError("De presentatie bevat te veel tekst.")
            return pages
        if kind == "xlsx":
            shared = []
            if "xl/sharedStrings.xml" in names:
                shared = ["".join(t.text or "" for t in si.iter(X + "t")) for si in xml("xl/sharedStrings.xml").iter(X + "si")]
            relations = {e.attrib["Id"]: e.attrib.get("Target", "") for e in xml("xl/_rels/workbook.xml.rels")}
            pages = []
            for sheet in xml("xl/workbook.xml").iter(X + "sheet"):
                target = relations.get(sheet.attrib.get(R + "id"), "").replace("\\", "/")
                name = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
                rows = [f"Werkblad: {sheet.attrib.get('name', '')}"]
                for row in xml(name).iter(X + "row"):
                    values = []
                    for cell in row.iter(X + "c"):
                        val = cell.findtext(X + "v", "")
                        if cell.attrib.get("t") == "s":
                            if not val.isdigit() or int(val) >= len(shared):
                                raise ValueError("Ongeldige celverwijzing in spreadsheet.")
                            val = shared[int(val)]
                        elif cell.attrib.get("t") == "inlineStr":
                            val = "".join(t.text or "" for t in cell.iter(X + "t"))
                        formula = cell.findtext(X + "f")
                        values.append(f"{cell.attrib.get('r', '')}: {val}" + (f" [formule: {formula}]" if formula else ""))
                    rows.append("\t".join(values))
                pages.extend(chunks("\n".join(rows)))
            if not pages or len(pages) > 200 or sum(map(len, pages)) > MAX_TEXT:
                raise ValueError("Het spreadsheet is leeg of te groot.")
            return pages
    raise ValueError("Bestandstype niet ondersteund.")


MEDIA_TYPES = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "txt": "text/plain",
    "csv": "text/csv",
}
