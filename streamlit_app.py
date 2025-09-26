import streamlit as st
from PIL import Image
from streamlit_cropper import st_cropper

from app.season_matcher import dominant_hex_colors, rank_seasons, load_palettes

# -------- Page setup --------
st.set_page_config(page_title="Color Season Shopper", page_icon="🎨")

st.title("🎨 Color Season Shopper — MVP Demo")
st.write(
    "Upload a clothing/product image. Drag to crop/zoom around the garment to avoid skin, hair, or background."
)

# Optional quick reset (great while iterating)
col_reset, _ = st.columns([1, 6])
with col_reset:
    if st.button("Reset"):
        st.experimental_rerun()

# -------- Load palettes --------
# Loads JSON if present; otherwise falls back to DEFAULT_PALETTES in season_matcher.py
palettes = load_palettes("data/palettes.json")

# -------- Upload --------
uploaded = st.file_uploader("Upload an image", type=["jpg", "jpeg", "png", "webp"])

if uploaded:
    # Open original
    original = Image.open(uploaded).convert("RGB")
    st.image(original, caption="Original", use_container_width=True)

    # -------- Interactive cropper --------
    st.caption("Tip: zoom with mouse/trackpad and drag to isolate the garment.")
    cropped = st_cropper(
        original,
        realtime_update=True,
        box_color="#2E86C1",
        aspect_ratio=None,  # TODO: set (3,4) for dresses etc. if you want a fixed ratio later
    )

    # Use cropped if available; otherwise fall back to original
    target_img = cropped if isinstance(cropped, Image.Image) else original

    # Show cropped preview so it's clear what we analyze
    st.image(target_img, caption="Cropped preview (analyzed)", use_container_width=True)

    # -------- Extract dominant colors --------
    # Internal default: 5 colors (no user control—keeps UI simple)
    hexes = dominant_hex_colors(target_img, n_colors=5, crop_box=None)

    if hexes:
        # Render color chips rather than a comma string (easier to scan)
        st.write("**Detected colors:**")
        chip_cols = st.columns(min(len(hexes), 5))
        for i, h in enumerate(hexes):
            with chip_cols[i % len(chip_cols)]:
                # Disabled color pickers = nice read-only swatches
                st.color_picker(label=h, value=h, key=f"hex-{i}", disabled=True)

        # -------- Rank seasons --------
        ranking = rank_seasons(hexes, palettes)
        if ranking:
            top3 = ranking[:3]
            best = top3[0][0]

            st.subheader(f"✅ Best for: {best}")

            if len(top3) > 1:
                others = [s for (s, _score) in top3[1:]]
                st.write("**Also works for:** " + " · ".join(others))

            # Keep numbers hidden by default; handy for your tuning
            with st.expander("Details (color math)", expanded=False):
                st.caption("Lower = closer match in Lab color space (ΔE76 average across dominant colors).")
                for s, score in top3:
                    st.write(f"- {s}: ~{score:.1f}")
        else:
            st.warning("Couldn’t compute a ranking for this image. Try cropping tighter on the garment.")
    else:
        st.warning("No dominant colors detected — try cropping tighter on the garment.")
