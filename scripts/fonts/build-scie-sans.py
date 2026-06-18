from __future__ import annotations

import shutil
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen


ROOT = Path(__file__).resolve().parents[2]
INTER_VERSION = "4.1"
SOURCE_DIR = ROOT / "vendor" / "inter" / f"Inter-{INTER_VERSION}" / "extras" / "ttf"
SOURCE_LICENSE = ROOT / "vendor" / "inter" / f"Inter-{INTER_VERSION}" / "LICENSE.txt"
OUTPUT_DIR = ROOT / "public" / "fonts" / "scie-sans"
TTF_ARTIFACT_DIR = ROOT / "artifacts" / "fonts" / "scie-sans-ttf"

FAMILY_NAME = "Scie Sans"
PS_FAMILY_NAME = "ScieSans"
COMPACT_FAMILY_NAME = "Scie Sans Compact"
COMPACT_PS_FAMILY_NAME = "ScieSansCompact"
COMPACT_WIDTH_SCALE = 0.78
COMPACT_OUTPUT_SUBDIR = "compact-v1.320"
VERSION = "1.320"
DESIGN_PASS = "v0.4.2 compact"

FONT_STYLES = {
    "Light": {"source": "Light", "label": "Light", "weight": 300, "italic": False},
    "Regular": {"source": "Regular", "label": "Regular", "weight": 400, "italic": False},
    "Medium": {"source": "Medium", "label": "Medium", "weight": 500, "italic": False},
    "Bold": {"source": "Bold", "label": "Bold", "weight": 700, "italic": False},
    "LightItalic": {"source": "LightItalic", "label": "Light Italic", "weight": 300, "italic": True},
    "Italic": {"source": "Italic", "label": "Italic", "weight": 400, "italic": True},
    "MediumItalic": {"source": "MediumItalic", "label": "Medium Italic", "weight": 500, "italic": True},
    "BoldItalic": {"source": "BoldItalic", "label": "Bold Italic", "weight": 700, "italic": True},
}

COMPACT_STYLES = {
    "Light": {"source": "Light", "label": "Light", "weight": 300, "italic": False},
    "Regular": {"source": "Regular", "label": "Regular", "weight": 400, "italic": False},
    "Medium": {"source": "Medium", "label": "Medium", "weight": 500, "italic": False},
}

STYLE_LINKED_LABELS = {"Regular", "Bold", "Italic", "Bold Italic"}

SCIENTIFIC_TEST_STRINGS = [
    "I1l O0 Al2O3 OER-01 Il-10",
    "I1l O0 10\u207b\u00b3 mol L\u207b\u00b9",
    "CO\u2082RR, OER, HER, H\u2082O, SO\u2084\u00b2\u207b",
    "5 mA cm\u207b\u00b2, 1.23 V vs RHE",
    "\u03b1-Fe\u2082O\u2083, RuO\u2082, IrOx, NiFe-LDH",
    "\u03b7OER, \u0394G, \u03bbmax, \u03bcm, \u00b5L, k\u03a9",
    "A \u21cc B, A \u2192 B, \u22120.2 V, \u00b15%",
    "\u00b9\u2074C, \u00b2\u00b3\u2078U",
    "(1\u030510), [001]",
    "25\u202f\u00b0C, 5.0\u202fmA\u202fcm\u207b\u00b2, 100\u202f\u00b5L",
    "\u03d5 \u03c6, \u03d1 \u03b8, \u03f5 \u03b5, \u03f0 \u03ba, \u03f1 \u03c1, \u03d6 \u03c0",
]


def set_name(font: TTFont, name_id: int, value: str | None) -> None:
    name_table = font["name"]
    name_table.removeNames(nameID=name_id)
    if value is None:
        return
    for platform_id, plat_enc_id, lang_id in ((3, 1, 0x409),):
        name_table.setName(value, name_id, platform_id, plat_enc_id, lang_id)


def make_names(
    family_name: str,
    ps_family_name: str,
    output_style: str,
    style_label: str,
    width_label: str,
) -> dict[int, str | None]:
    postscript_name = f"{ps_family_name}-{output_style}"
    full_name = f"{family_name} {style_label}"
    if style_label in STYLE_LINKED_LABELS:
        legacy_family = family_name
        legacy_subfamily = style_label
    else:
        roman_style = style_label.replace(" Italic", "")
        legacy_family = f"{family_name} {roman_style}"
        legacy_subfamily = "Italic" if style_label.endswith(" Italic") else "Regular"

    names = {
        0: "Copyright (c) 2016 The Inter Project Authors; modified 2026 Scienfy contributors.",
        1: legacy_family,
        2: legacy_subfamily,
        3: f"{VERSION};Scienfy;{postscript_name}",
        4: full_name,
        5: f"Version {VERSION}; derived from Inter {INTER_VERSION}",
        6: postscript_name,
        7: (
            "Scie Sans and Scie Sans Compact are Reserved Font Names of Scienfy. "
            "Inter is a Reserved Font Name of Rasmus Andersson."
        ),
        8: "Scienfy",
        9: "The Inter Project Authors; modified by Scienfy contributors",
        10: (
            f"{family_name} is a {width_label} Modified Version derived from "
            f"Inter {INTER_VERSION} under the SIL Open Font License."
        ),
        11: "https://github.com/rsms/inter",
        12: "https://github.com/rsms/inter",
        13: (
            "This Font Software is licensed under the SIL Open Font License, "
            "Version 1.1. See OFL.txt. This is not an official Inter release."
        ),
        14: "https://openfontlicense.org",
    }
    names[16] = family_name
    names[17] = style_label
    names[21] = family_name
    names[22] = style_label
    return names


def rename_font(
    family_name: str,
    ps_family_name: str,
    output_style: str,
    metadata: dict[str, str | int | bool],
    width_scale: float = 1.0,
    width_class: int = 5,
    width_label: str = "normal-width",
    output_dir: Path = OUTPUT_DIR,
    ttf_output_dir: Path = TTF_ARTIFACT_DIR,
) -> None:
    source_style = str(metadata["source"])
    style_label = str(metadata["label"])
    source = SOURCE_DIR / f"Inter-{source_style}.ttf"
    if not source.exists():
        raise FileNotFoundError(source)

    font = TTFont(source)
    for name_id, value in make_names(family_name, ps_family_name, output_style, style_label, width_label).items():
        set_name(font, name_id, value)

    apply_scie_sans_design_pass(font)
    if width_scale != 1.0:
        apply_width_variant(font, width_scale)
        tune_scientific_metrics(font)
        recalculate_horizontal_bounds(font)

    font["head"].fontRevision = float(VERSION)
    font["OS/2"].usWeightClass = int(metadata["weight"])
    font["OS/2"].usWidthClass = width_class
    font["OS/2"].fsType = 0
    font["OS/2"].achVendID = "SCIE"

    output_dir.mkdir(parents=True, exist_ok=True)
    ttf_output_dir.mkdir(parents=True, exist_ok=True)
    ttf_path = ttf_output_dir / f"{ps_family_name}-{output_style}.ttf"
    woff2_path = output_dir / f"{ps_family_name}-{output_style}.woff2"

    font.save(ttf_path)

    web_font = TTFont(ttf_path)
    web_font.flavor = "woff2"
    web_font.save(woff2_path)


def clean_runtime_output() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for path in OUTPUT_DIR.glob("*.ttf"):
        path.unlink()
    for path in OUTPUT_DIR.glob("ScieSansCompact-*.woff2"):
        path.unlink()
    for path in OUTPUT_DIR.glob("compact-v*"):
        if path.is_dir() and path.name != COMPACT_OUTPUT_SUBDIR:
            shutil.rmtree(path)
    backups = OUTPUT_DIR / ".scienfy-backups"
    if backups.exists():
        shutil.rmtree(backups)


def apply_scie_sans_design_pass(font: TTFont) -> None:
    if not is_italic_font(font):
        add_capital_i_bars(font)
        add_lower_l_terminal(font)
        add_digit_one_feet(font)
    tune_zero_distinction(font)
    tune_scientific_metrics(font)
    add_scientific_cmap_aliases(font)


def is_italic_font(font: TTFont) -> bool:
    return bool(font["OS/2"].fsSelection & 0x01) or font["post"].italicAngle != 0


def draw_clockwise_rect(pen: TTGlyphPen, left: int, bottom: int, right: int, top: int) -> None:
    pen.moveTo((left, bottom))
    pen.lineTo((left, top))
    pen.lineTo((right, top))
    pen.lineTo((right, bottom))
    pen.closePath()


def append_rect(font: TTFont, glyph_name: str, left: int, bottom: int, right: int, top: int) -> None:
    if glyph_name not in font.getGlyphOrder():
        return
    glyf = font["glyf"]
    source_glyph = glyf[glyph_name]
    if source_glyph.isComposite():
        return
    pen = TTGlyphPen(glyf)
    source_glyph.draw(pen, glyf)
    draw_clockwise_rect(pen, left, bottom, right, top)
    glyf[glyph_name] = pen.glyph()
    glyf[glyph_name].recalcBounds(glyf)
    font["hmtx"].metrics[glyph_name] = (font["hmtx"][glyph_name][0], glyf[glyph_name].xMin)


def glyph_bounds(font: TTFont, glyph_name: str) -> tuple[int, int, int, int] | None:
    if glyph_name not in font.getGlyphOrder():
        return None
    glyph = font["glyf"][glyph_name]
    glyph.recalcBounds(font["glyf"])
    if getattr(glyph, "xMin", None) is None:
        return None
    return glyph.xMin, glyph.yMin, glyph.xMax, glyph.yMax


def add_capital_i_bars(font: TTFont) -> None:
    bounds = glyph_bounds(font, "I")
    if bounds is None:
        return
    x_min, y_min, x_max, y_max = bounds
    advance = font["hmtx"]["I"][0]
    stem = max(1, x_max - x_min)
    bar_height = max(40, min(74, round(stem * 0.30)))
    extension = round(stem * 0.42)
    left = max(64, x_min - extension)
    right = min(advance - 64, x_max + extension)
    append_rect(font, "I", left, y_min, right, y_min + bar_height)
    append_rect(font, "I", left, y_max - bar_height, right, y_max)


def add_lower_l_terminal(font: TTFont) -> None:
    bounds = glyph_bounds(font, "l")
    if bounds is None:
        return
    x_min, y_min, x_max, _ = bounds
    advance = font["hmtx"]["l"][0]
    stem = max(1, x_max - x_min)
    terminal_height = max(44, min(80, round(stem * 0.30)))
    left = x_max - round(stem * 0.18)
    right = min(advance - 54, x_max + round(stem * 0.45))
    append_rect(font, "l", left, y_min, right, y_min + terminal_height)


def add_digit_one_feet(font: TTFont) -> None:
    for glyph_name in ("one", "one.tf", "one.sups", "one.subs", "one.dnom", "one.numr"):
        bounds = glyph_bounds(font, glyph_name)
        if bounds is None:
            continue
        x_min, y_min, x_max, y_max = bounds
        advance = font["hmtx"][glyph_name][0]
        glyph_height = max(1, y_max - y_min)
        foot_height = max(24, min(60, round(glyph_height * 0.038)))
        left = max(48, x_min - round((x_max - x_min) * 0.03))
        right = min(advance - 48, x_max + round((x_max - x_min) * 0.09))
        append_rect(font, glyph_name, left, y_min, right, y_min + foot_height)


def tune_zero_distinction(font: TTFont) -> None:
    scale = zero_distinction_scale(font)
    zero_glyphs = (
        "zero",
        "zero.tf",
        "zero.sups",
        "zero.subs",
        "zero.dnom",
        "zero.numr",
        "zero.slash",
        "zero.tf.slash",
        "zero.sups.slash",
        "zero.subs.slash",
        "zero.dnom.slash",
        "zero.numr.slash",
    )
    for glyph_name in zero_glyphs:
        scale_glyph_x(font, glyph_name, scale)


def zero_distinction_scale(font: TTFont) -> float:
    zero_bounds = glyph_bounds(font, "zero")
    o_bounds = glyph_bounds(font, "O")
    if zero_bounds is None or o_bounds is None:
        return 0.92
    zero_width = zero_bounds[2] - zero_bounds[0]
    o_width = o_bounds[2] - o_bounds[0]
    if zero_width <= 0 or o_width <= 0:
        return 0.92
    target_width = min(zero_width * 0.92, o_width * 0.74)
    return target_width / zero_width


def tune_scientific_metrics(font: TTFont) -> None:
    upem = font["head"].unitsPerEm
    set_advance(font, "uni202F", round(upem / 6))
    set_advance(font, "uni00A0", font["hmtx"]["space"][0])
    if "zero.tf" in font["hmtx"].metrics:
        target_tabular_width = font["hmtx"]["zero.tf"][0]
        for glyph_name in ("minus", "minus.tf", "plusminus", "plusminus.tf"):
            set_advance(font, glyph_name, target_tabular_width, center_outline=True)


def set_advance(font: TTFont, glyph_name: str, advance: int, center_outline: bool = False) -> None:
    if glyph_name not in font["hmtx"].metrics:
        return
    old_advance, old_lsb = font["hmtx"][glyph_name]
    lsb = old_lsb
    if center_outline:
        bounds = glyph_bounds(font, glyph_name)
        if bounds is not None:
            x_min, _, x_max, _ = bounds
            outline_width = x_max - x_min
            lsb = round((advance - outline_width) / 2)
            shift_glyph_x(font, glyph_name, lsb - x_min)
    font["hmtx"].metrics[glyph_name] = (advance, lsb)


def shift_glyph_x(font: TTFont, glyph_name: str, dx: int) -> None:
    if dx == 0:
        return
    glyf = font["glyf"]
    glyph = glyf[glyph_name]
    if glyph.isComposite():
        for component in glyph.components:
            component.x += dx
    elif glyph.numberOfContours > 0:
        coordinates, _, _ = glyph.getCoordinates(glyf)
        for index in range(len(coordinates)):
            x, y = coordinates[index]
            coordinates[index] = (x + dx, y)
        glyph.coordinates = coordinates
    glyph.recalcBounds(glyf)


def scale_glyph_x(font: TTFont, glyph_name: str, scale: float) -> None:
    bounds = glyph_bounds(font, glyph_name)
    if bounds is None:
        return
    glyf = font["glyf"]
    glyph = glyf[glyph_name]
    if glyph.isComposite() or glyph.numberOfContours <= 0:
        return
    x_min, _, x_max, _ = bounds
    center = (x_min + x_max) / 2
    coordinates, _, _ = glyph.getCoordinates(glyf)
    for index in range(len(coordinates)):
        x, y = coordinates[index]
        coordinates[index] = (round(center + ((x - center) * scale)), y)
    glyph.coordinates = coordinates
    glyph.recalcBounds(glyf)
    font["hmtx"].metrics[glyph_name] = (font["hmtx"][glyph_name][0], glyph.xMin)


def apply_width_variant(font: TTFont, width_scale: float) -> None:
    glyf = font["glyf"]
    for glyph_name in font.getGlyphOrder():
        glyph = glyf[glyph_name]
        if glyph.isComposite():
            for component in glyph.components:
                component.x = round(component.x * width_scale)
        elif glyph.numberOfContours > 0:
            coordinates, _, _ = glyph.getCoordinates(glyf)
            for index in range(len(coordinates)):
                x, y = coordinates[index]
                coordinates[index] = (round(x * width_scale), y)
            glyph.coordinates = coordinates
        glyph.recalcBounds(glyf)

    for glyph_name, (advance, lsb) in list(font["hmtx"].metrics.items()):
        font["hmtx"].metrics[glyph_name] = (round(advance * width_scale), round(lsb * width_scale))

    if "kern" in font:
        for table in font["kern"].kernTables:
            for pair, value in list(table.kernTable.items()):
                table.kernTable[pair] = round(value * width_scale)

    recalculate_horizontal_bounds(font)


def recalculate_horizontal_bounds(font: TTFont) -> None:
    glyf = font["glyf"]
    bounds: list[tuple[int, int, int, int]] = []
    min_lsb: int | None = None
    min_rsb: int | None = None
    x_max_extent: int | None = None
    advance_width_max = 0

    for glyph_name in font.getGlyphOrder():
        glyph = glyf[glyph_name]
        glyph.recalcBounds(glyf)
        advance, lsb = font["hmtx"].metrics[glyph_name]
        advance_width_max = max(advance_width_max, advance)
        min_lsb = lsb if min_lsb is None else min(min_lsb, lsb)
        if getattr(glyph, "xMin", None) is not None:
            glyph_bounds_tuple = (glyph.xMin, glyph.yMin, glyph.xMax, glyph.yMax)
            bounds.append(glyph_bounds_tuple)
            glyph_width = glyph.xMax - glyph.xMin
            right_side_bearing = advance - lsb - glyph_width
            min_rsb = right_side_bearing if min_rsb is None else min(min_rsb, right_side_bearing)
            extent = lsb + glyph_width
            x_max_extent = extent if x_max_extent is None else max(x_max_extent, extent)

    if bounds:
        font["head"].xMin = min(item[0] for item in bounds)
        font["head"].yMin = min(item[1] for item in bounds)
        font["head"].xMax = max(item[2] for item in bounds)
        font["head"].yMax = max(item[3] for item in bounds)

    font["hhea"].advanceWidthMax = advance_width_max
    font["hhea"].minLeftSideBearing = min_lsb or 0
    font["hhea"].minRightSideBearing = min_rsb or 0
    font["hhea"].xMaxExtent = x_max_extent or 0
    font["OS/2"].xAvgCharWidth = average_char_width(font)


def average_char_width(font: TTFont) -> int:
    sample = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    cmap = font.getBestCmap()
    advances = [
        font["hmtx"].metrics[glyph_name][0]
        for codepoint in map(ord, sample)
        if (glyph_name := cmap.get(codepoint)) in font["hmtx"].metrics
    ]
    if not advances:
        return font["OS/2"].xAvgCharWidth
    return round(sum(advances) / len(advances))


def add_scientific_cmap_aliases(font: TTFont) -> None:
    aliases = {
        0x2219: "periodcentered",
        0x212B: "Aring",
    }
    glyph_order = set(font.getGlyphOrder())
    for table in font["cmap"].tables:
        if not table.isUnicode():
            continue
        for codepoint, glyph_name in aliases.items():
            if glyph_name in glyph_order:
                table.cmap[codepoint] = glyph_name


def write_license_files() -> None:
    original = SOURCE_LICENSE.read_text(encoding="utf-8")
    _, license_body = original.split("This Font Software is licensed", 1)
    ofl = (
        "Copyright (c) 2016 The Inter Project Authors "
        "(https://github.com/rsms/inter), with Reserved Font Name \"Inter\".\n"
        "Copyright (c) 2026 Scienfy contributors, with Reserved Font Name "
        "\"Scie Sans\".\n\n"
        "This Font Software is licensed" + license_body
    )
    (OUTPUT_DIR / "OFL.txt").write_text(ofl, encoding="utf-8")
    (OUTPUT_DIR / "FONTLOG.txt").write_text(
        "\n".join(
            [
                "Scie Sans FONTLOG",
                "=================",
                "",
                "2026-05-23: Scie Sans 1.320",
                "- Strengthened the v0.4.2 compact-width family pass after Helvetica Neue Compact comparison showed a much stronger prose-width reduction.",
                f"- Derived normal-width Light, Regular, Medium, Bold, and matching italic fonts from Inter {INTER_VERSION}.",
                "- Derived compact-width Light, Regular, and Medium fonts from the Scie Sans design pass.",
                "- Renamed all user-facing font names and PostScript names from Inter to Scie Sans.",
                "- Softened functional bars on capital I, the right-foot terminal on lowercase l, and the base foot on digit 1.",
                "- Narrowed the plain zero outline so O/0 remain distinct without making slashed zero the default.",
                "- Tuned U+2212 minus to tabular figure width and standardized U+202F narrow no-break space.",
                "- Added U+2219 bullet operator coverage via the centered-dot glyph.",
                "- Added Scie Sans copyright, license metadata, and Reserved Font Name notice.",
                "- Kept WOFF2 files in the ScieMD runtime bundle and full TTF artifacts under ignored release artifacts.",
                "",
                "This is a Modified Version under the SIL Open Font License 1.1 and is not an official Inter release.",
                "",
            ]
        ),
        encoding="utf-8",
    )
    (OUTPUT_DIR / "README.md").write_text(
        "\n".join(
            [
                "# Scie Sans",
                "",
                f"Scie Sans is a derivative of Inter {INTER_VERSION}, renamed and modified for Scienfy Inc./ScieMD use.",
                "It is distributed under the SIL Open Font License 1.1.",
                "",
                f"Current font version: {VERSION} ({DESIGN_PASS} scientific design pass).",
                "",
                "This folder is the runtime font bundle shipped with ScieMD. It intentionally keeps only",
                "the WOFF2 files loaded by the app and the license/supporting documentation. Old compact",
                "builds, backup drafts, duplicate compact files, and TTF desktop-test artifacts are not kept",
                "here because they increase release size without being used by the app.",
                "",
                "## Runtime Files",
                "",
                "Main family:",
                "",
                "- `ScieSans-Light.woff2`",
                "- `ScieSans-Regular.woff2`",
                "- `ScieSans-Medium.woff2`",
                "- `ScieSans-Bold.woff2`",
                "- `ScieSans-LightItalic.woff2`",
                "- `ScieSans-Italic.woff2`",
                "- `ScieSans-MediumItalic.woff2`",
                "- `ScieSans-BoldItalic.woff2`",
                "",
                "Compact family:",
                "",
                f"- `{COMPACT_OUTPUT_SUBDIR}/ScieSansCompact-Light.woff2`",
                f"- `{COMPACT_OUTPUT_SUBDIR}/ScieSansCompact-Regular.woff2`",
                f"- `{COMPACT_OUTPUT_SUBDIR}/ScieSansCompact-Medium.woff2`",
                "",
                "The app loads these files through CSS `@font-face` rules. Open `specimen.html` in this",
                "folder for a quick visual check of the scientific test strings.",
                "",
                "## Regenerating Development Artifacts",
                "",
                "Run `npm run fonts:scie-sans` from the project root to regenerate the full font build,",
                "including TTF files for desktop testing in apps such as Word. The TTF files are written",
                "to ignored `artifacts/fonts/scie-sans-ttf/`; only WOFF2 runtime files are kept in `public/`.",
                "",
                "## Design Notes",
                "",
                "This pass makes targeted scientific/UI deltas while preserving Inter's core proportions:",
                "",
                "- capital `I` has subtle functional bars",
                "- lowercase `l` has a right-foot terminal",
                "- digit `1` has a clearer base foot",
                "- plain `0` is slightly narrower for O/0 distinction without using slashed zero by default",
                "- compact-width Light, Regular, and Medium cuts are available as `Scie Sans Compact`",
                "- U+2212 minus is tabular-width for numeric alignment",
                "- U+202F narrow no-break space is standardized for value-unit spacing",
                "- U+2219 bullet operator maps to the centered-dot drawing",
                "",
            ]
        ),
        encoding="utf-8",
    )
    write_specimen()


def write_specimen() -> None:
    (OUTPUT_DIR / "QA.md").write_text(
        "\n".join(
            [
                "# Scie Sans QA Strings",
                "",
                "Use these strings in ScieMD, Word, browser screenshots, and print/PDF checks.",
                "",
                "## Scientific Strings",
                "",
                *[f"- {text}" for text in SCIENTIFIC_TEST_STRINGS],
                "",
                "## Required Checks",
                "",
                "- `I`, `l`, and `1` must remain distinct at 12-16 px and at 6-8 pt print size.",
                "- Plain `0` remains default; slashed zero is available through OpenType `zero`.",
                "- `O` and plain `0` must remain distinct without enabling slashed zero.",
                "- Compact Light, Regular, and Medium must save horizontal space without collapsing `I`, `l`, `1`, `O`, and `0`.",
                "- U+2212 minus aligns with tabular numerals in signed numeric columns.",
                "- U+202F narrow no-break space is visible only as value-unit spacing, not as a large word gap.",
                "- U+2219 renders as a centered operator dot, distinct from period.",
                "",
            ]
        ),
        encoding="utf-8",
    )
    rows = "\n".join(f"<p>{escape_html(text)}</p>" for text in SCIENTIFIC_TEST_STRINGS)
    (OUTPUT_DIR / "specimen.html").write_text(
        "\n".join(
            [
                "<!doctype html>",
                "<html lang=\"en\">",
                "<head>",
                "<meta charset=\"utf-8\">",
                "<title>Scie Sans Specimen</title>",
                "<style>",
                "@font-face{font-family:'Scie Sans';src:url('./ScieSans-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}",
                "@font-face{font-family:'Scie Sans';src:url('./ScieSans-Medium.woff2') format('woff2');font-weight:500;font-style:normal;font-display:swap}",
                "@font-face{font-family:'Scie Sans';src:url('./ScieSans-Bold.woff2') format('woff2');font-weight:700;font-style:normal;font-display:swap}",
                "@font-face{font-family:'Scie Sans';src:url('./ScieSans-LightItalic.woff2') format('woff2');font-weight:300;font-style:italic;font-display:swap}",
                "@font-face{font-family:'Scie Sans';src:url('./ScieSans-Italic.woff2') format('woff2');font-weight:400;font-style:italic;font-display:swap}",
                "@font-face{font-family:'Scie Sans';src:url('./ScieSans-MediumItalic.woff2') format('woff2');font-weight:500;font-style:italic;font-display:swap}",
                "@font-face{font-family:'Scie Sans';src:url('./ScieSans-BoldItalic.woff2') format('woff2');font-weight:700;font-style:italic;font-display:swap}",
                f"@font-face{{font-family:'Scie Sans Compact';src:url('./{COMPACT_OUTPUT_SUBDIR}/ScieSansCompact-Light.woff2') format('woff2');font-weight:300;font-style:normal;font-display:swap}}",
                f"@font-face{{font-family:'Scie Sans Compact';src:url('./{COMPACT_OUTPUT_SUBDIR}/ScieSansCompact-Regular.woff2') format('woff2');font-weight:400;font-style:normal;font-display:swap}}",
                f"@font-face{{font-family:'Scie Sans Compact';src:url('./{COMPACT_OUTPUT_SUBDIR}/ScieSansCompact-Medium.woff2') format('woff2');font-weight:500;font-style:normal;font-display:swap}}",
                "body{margin:40px;font-family:'Scie Sans',sans-serif;color:#14201c;background:#f7f9f8;line-height:1.45}",
                "main{max-width:980px;margin:auto}",
                "h1{font-size:34px;font-weight:700;margin:0 0 24px}",
                "h2{font-size:16px;font-weight:700;margin:32px 0 10px;color:#4b5c55;text-transform:uppercase;letter-spacing:.06em}",
                "p{margin:.35rem 0;font-size:22px}",
                ".small p{font-size:12px}",
                ".figure p{font-size:8pt;letter-spacing:.012em}",
                ".tabular{font-feature-settings:'tnum' 1}",
                ".zero{font-feature-settings:'tnum' 1,'zero' 1}",
                "</style>",
                "</head>",
                "<body>",
                "<main>",
                "<h1>Scie Sans scientific specimen</h1>",
                "<h2>Text size</h2>",
                rows,
                "<h2>Compact text size</h2>",
                f"<section style=\"font-family:'Scie Sans Compact',sans-serif\">{rows}</section>",
                "<h2>Compact dense table text</h2>",
                f"<section class=\"figure tabular\" style=\"font-family:'Scie Sans Compact',sans-serif\">{rows}</section>",
                "<h2>Italic text size</h2>",
                f"<section style=\"font-style:italic\">{rows}</section>",
                "<h2>GUI size</h2>",
                f"<section class=\"small\">{rows}</section>",
                "<h2>Figure size</h2>",
                f"<section class=\"figure tabular\">{rows}</section>",
                "<h2>Tabular slashed-zero feature</h2>",
                "<p class=\"zero\">O0 OER-01 CO2RR-00 I1l</p>",
                "</main>",
                "</body>",
                "</html>",
                "",
            ]
        ),
        encoding="utf-8",
    )


def escape_html(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def main() -> None:
    clean_runtime_output()
    for output_style, metadata in FONT_STYLES.items():
        rename_font(FAMILY_NAME, PS_FAMILY_NAME, output_style, metadata)
    for output_style, metadata in COMPACT_STYLES.items():
        rename_font(
            COMPACT_FAMILY_NAME,
            COMPACT_PS_FAMILY_NAME,
            output_style,
            metadata,
            width_scale=COMPACT_WIDTH_SCALE,
            width_class=4,
            width_label="compact-width",
            output_dir=OUTPUT_DIR / COMPACT_OUTPUT_SUBDIR,
            ttf_output_dir=TTF_ARTIFACT_DIR / COMPACT_OUTPUT_SUBDIR,
        )
    write_license_files()


if __name__ == "__main__":
    main()
