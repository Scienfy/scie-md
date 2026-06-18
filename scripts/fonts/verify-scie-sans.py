from __future__ import annotations

from pathlib import Path

from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[2]
INTER_VERSION = "4.1"
SOURCE_DIR = ROOT / "vendor" / "inter" / f"Inter-{INTER_VERSION}" / "extras" / "ttf"
OUTPUT_DIR = ROOT / "public" / "fonts" / "scie-sans"
COMPACT_OUTPUT_SUBDIR = "compact-v1.320"

FONT_STYLES = {
    "ScieSans-Light": {"source": "Light", "italic": False, "check_shapes": True, "width_class": 5, "compact": False},
    "ScieSans-Regular": {"source": "Regular", "italic": False, "check_shapes": True, "width_class": 5, "compact": False},
    "ScieSans-Medium": {"source": "Medium", "italic": False, "check_shapes": True, "width_class": 5, "compact": False},
    "ScieSans-Bold": {"source": "Bold", "italic": False, "check_shapes": True, "width_class": 5, "compact": False},
    "ScieSans-LightItalic": {"source": "LightItalic", "italic": True, "check_shapes": False, "width_class": 5, "compact": False},
    "ScieSans-Italic": {"source": "Italic", "italic": True, "check_shapes": False, "width_class": 5, "compact": False},
    "ScieSans-MediumItalic": {"source": "MediumItalic", "italic": True, "check_shapes": False, "width_class": 5, "compact": False},
    "ScieSans-BoldItalic": {"source": "BoldItalic", "italic": True, "check_shapes": False, "width_class": 5, "compact": False},
    "ScieSansCompact-Light": {"source": "Light", "italic": False, "check_shapes": False, "width_class": 4, "compact": True},
    "ScieSansCompact-Regular": {"source": "Regular", "italic": False, "check_shapes": False, "width_class": 4, "compact": True},
    "ScieSansCompact-Medium": {"source": "Medium", "italic": False, "check_shapes": False, "width_class": 4, "compact": True},
}
USER_FACING_NAME_IDS = (1, 2, 3, 4, 6, 16, 17, 21, 22)
REQUIRED_FEATURES = {"zero", "tnum", "pnum", "sups", "subs", "sinf", "numr", "dnom", "frac"}
REQUIRED_CODEPOINTS = {
    0x00B5: "micro sign",
    0x00C5: "A with ring",
    0x03BC: "Greek mu",
    0x03D1: "theta symbol",
    0x03D5: "phi symbol",
    0x03D6: "varpi",
    0x03F0: "kappa symbol",
    0x03F1: "rho symbol",
    0x03F5: "epsilon symbol",
    0x202F: "narrow no-break space",
    0x212B: "angstrom sign",
    0x2212: "minus sign",
    0x2219: "bullet operator",
    0x2032: "prime",
    0x2033: "double prime",
}


def main() -> None:
    for output_style, metadata in FONT_STYLES.items():
        verify_style(output_style, metadata)
    print("Scie Sans font verification OK")


def verify_style(output_style: str, metadata: dict[str, str | bool | int]) -> None:
    source = TTFont(SOURCE_DIR / f"Inter-{metadata['source']}.ttf")
    output_dir = OUTPUT_DIR / COMPACT_OUTPUT_SUBDIR if metadata["compact"] else OUTPUT_DIR
    font_path = output_dir / f"{output_style}.woff2"
    if not font_path.exists():
        raise AssertionError(f"Missing WOFF2 for {output_style}: {font_path}")
    font = TTFont(font_path)

    assert font["OS/2"].fsType == 0, f"{output_style}: fsType must allow embedding"
    assert font["OS/2"].achVendID == "SCIE", f"{output_style}: vendor id should be SCIE"
    assert is_italic(font) is bool(metadata["italic"]), f"{output_style}: italic metadata does not match the style"
    assert font["OS/2"].usWidthClass == int(metadata["width_class"]), f"{output_style}: unexpected width class"

    verify_names(font, output_style)
    verify_features(font, output_style)
    verify_coverage(font, output_style)
    if metadata["check_shapes"]:
        verify_design_deltas(source, font, output_style)
    verify_zero_distinction(source, font, output_style)
    if metadata["compact"]:
        verify_compact_width(source, font, output_style)
    verify_metrics(font, output_style)


def verify_names(font: TTFont, weight: str) -> None:
    for name_id in USER_FACING_NAME_IDS:
        value = font["name"].getDebugName(name_id)
        if value and "Inter" in value:
            raise AssertionError(f"{weight}: user-facing name ID {name_id} still mentions Inter: {value}")
    postscript = font["name"].getDebugName(6)
    if not postscript or not (postscript.startswith("ScieSans-") or postscript.startswith("ScieSansCompact-")):
        raise AssertionError(f"{weight}: unexpected PostScript name {postscript}")


def verify_features(font: TTFont, weight: str) -> None:
    if "GSUB" not in font:
        raise AssertionError(f"{weight}: missing GSUB")
    feature_tags = {record.FeatureTag for record in font["GSUB"].table.FeatureList.FeatureRecord}
    missing = REQUIRED_FEATURES - feature_tags
    if missing:
        raise AssertionError(f"{weight}: missing GSUB features {sorted(missing)}")


def verify_coverage(font: TTFont, weight: str) -> None:
    cmap = font.getBestCmap()
    missing = [f"U+{codepoint:04X} {label}" for codepoint, label in REQUIRED_CODEPOINTS.items() if codepoint not in cmap]
    if missing:
        raise AssertionError(f"{weight}: missing required codepoints: {', '.join(missing)}")
    if cmap[0x2219] != "periodcentered":
        raise AssertionError(f"{weight}: U+2219 should map to periodcentered")
    if cmap[0x212B] != "Aring":
        raise AssertionError(f"{weight}: U+212B should map to Aring")


def verify_design_deltas(source: TTFont, font: TTFont, weight: str) -> None:
    source_i = bounds(source, "I")
    scie_i = bounds(font, "I")
    if not (scie_i[0] < source_i[0] and scie_i[2] > source_i[2]):
        raise AssertionError(f"{weight}: capital I bars did not widen the glyph")

    source_l = bounds(source, "l")
    scie_l = bounds(font, "l")
    if not scie_l[2] > source_l[2]:
        raise AssertionError(f"{weight}: lowercase l terminal did not extend the glyph")

    source_one = bounds(source, "one")
    scie_one = bounds(font, "one")
    if not (scie_one[0] < source_one[0] and scie_one[2] > source_one[2]):
        raise AssertionError(f"{weight}: digit one foot did not widen the glyph")


def verify_zero_distinction(source: TTFont, font: TTFont, weight: str) -> None:
    source_zero = bounds(source, "zero")
    scie_zero = bounds(font, "zero")
    scie_o = bounds(font, "O")
    source_zero_width = source_zero[2] - source_zero[0]
    scie_zero_width = scie_zero[2] - scie_zero[0]
    scie_o_width = scie_o[2] - scie_o[0]
    if scie_zero_width > round(source_zero_width * 0.94):
        raise AssertionError(f"{weight}: plain zero was not narrowed enough for O/0 distinction")
    if scie_zero_width >= round(scie_o_width * 0.78):
        raise AssertionError(f"{weight}: plain zero is still too close to capital O width")


def verify_compact_width(source: TTFont, font: TTFont, weight: str) -> None:
    sample = ("H", "n", "m", "zero", "one", "A", "a")
    source_average = sum(source["hmtx"][glyph_name][0] for glyph_name in sample) / len(sample)
    scie_average = sum(font["hmtx"][glyph_name][0] for glyph_name in sample) / len(sample)
    ratio = scie_average / source_average
    if not 0.76 <= ratio <= 0.80:
        raise AssertionError(f"{weight}: compact advance ratio should be near 0.78, got {ratio:.3f}")


def verify_metrics(font: TTFont, weight: str) -> None:
    upem = font["head"].unitsPerEm
    hmtx = font["hmtx"]
    if hmtx["minus"][0] != hmtx["zero.tf"][0]:
        raise AssertionError(f"{weight}: U+2212 minus should be tabular figure width")
    if hmtx["uni202F"][0] != round(upem / 6):
        raise AssertionError(f"{weight}: U+202F should be one-sixth em")
    if hmtx["uni00A0"][0] != hmtx["space"][0]:
        raise AssertionError(f"{weight}: no-break space should match regular space")


def bounds(font: TTFont, glyph_name: str) -> tuple[int, int, int, int]:
    glyph = font["glyf"][glyph_name]
    glyph.recalcBounds(font["glyf"])
    return glyph.xMin, glyph.yMin, glyph.xMax, glyph.yMax


def is_italic(font: TTFont) -> bool:
    return bool(font["OS/2"].fsSelection & 0x01) or font["post"].italicAngle != 0


if __name__ == "__main__":
    main()
