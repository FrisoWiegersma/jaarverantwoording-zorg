"""Offline import fixtures: slide order and styling, spreadsheet cells, and invalid Office containers."""

import io
import unittest
import zipfile

import project_imports


def office(parts):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as z:
        for name, value in parts.items():
            z.writestr(name, value)
    return data.getvalue()


class ProjectImportsTest(unittest.TestCase):
    def test_powerpoint_slide_order_and_style(self):
        data = office(
            {
                "ppt/presentation.xml": '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="second"/><p:sldId r:id="first"/></p:sldIdLst><p:sldSz cx="1200" cy="900"/></p:presentation>',
                "ppt/_rels/presentation.xml.rels": '<Relationships><Relationship Id="first" Target="slides/slide1.xml"/><Relationship Id="second" Target="slides/slide2.xml"/></Relationships>',
                "ppt/slides/slide1.xml": '<a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>Omzet 2021</a:t></a:r></a:p>',
                "ppt/slides/slide2.xml": '<a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:rPr sz="3200"/><a:t>Huisstijl</a:t></a:r></a:p>',
                "ppt/theme/theme1.xml": '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:srgbClr val="163C49"/><a:latin typeface="Aptos"/></a:theme>',
            }
        )
        pages = project_imports.extract(data, "pptx")
        self.assertEqual(len(pages), 2)
        self.assertIn("Huisstijl", pages[0])
        self.assertIn("#163C49", pages[0])
        self.assertIn("Aptos", pages[0])
        self.assertIn("32.0", pages[0])
        self.assertIn("Omzet 2021", pages[1])

    def test_word_and_utf8_text(self):
        data = office(
            {
                "word/document.xml": '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Omzet € 100</w:t></w:r></w:p></w:document>'
            }
        )
        self.assertEqual(project_imports.extract(data, "docx"), ["Omzet € 100"])
        self.assertEqual(project_imports.extract(b"\xef\xbb\xbfOmzet 100", "txt"), ["Omzet 100"])
        self.assertIn("Omzet\t2025", project_imports.extract(b'Omzet;2025\n"Zorg, regio";100', "csv")[0])

    def test_excel_preserves_cells_and_does_not_execute_formulas(self):
        data = office(
            {
                "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Omzet" r:id="sheet1"/></sheets></workbook>',
                "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="sheet1" Target="worksheets/sheet1.xml"/></Relationships>',
                "xl/sharedStrings.xml": '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Bedrijfsopbrengsten</t></si></sst>',
                "xl/worksheets/sheet1.xml": '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1"><f>SUM(B2:B4)</f><v>123</v></c></row></sheetData></worksheet>',
            }
        )
        text = project_imports.extract(data, "xlsx")[0]
        self.assertIn("Werkblad: Omzet", text)
        self.assertIn("A1: Bedrijfsopbrengsten", text)
        self.assertIn("B1: 123 [formule: SUM(B2:B4)]", text)

    def test_invalid_and_oversized_inputs(self):
        for data, kind in [
            (b"not a zip", "pptx"),
            (b"\xff", "txt"),
            (b"\x00text", "txt"),
            (b" ", "txt"),
            (office({}), "docx"),
            (office({"word/document.xml": '<!DOCTYPE d [<!ENTITY x "boom">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">&x;</w:document>'}), "docx"),
            (
                office(
                    {
                        "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Omzet" r:id="sheet1"/></sheets></workbook>',
                        "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="sheet1" Target="worksheets/sheet1.xml"/></Relationships>',
                        "xl/worksheets/sheet1.xml": '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c r="A1" t="s"><v>99</v></c></row></sheetData></worksheet>',
                    }
                ),
                "xlsx",
            ),
        ]:
            with self.assertRaises((ValueError, zipfile.BadZipFile)):
                project_imports.extract(data, kind)
        with self.assertRaises(ValueError):
            project_imports.extract(b"a" * (project_imports.MAX_TEXT + 1), "txt")


if __name__ == "__main__":
    unittest.main()
