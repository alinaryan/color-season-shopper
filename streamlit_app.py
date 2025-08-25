import streamlit as st
from PIL import Image
from streamlit_cropper import st_cropper
from app.season_matcher import dominant_hex_colors, rank_seasons, load_palettes

st.set_page_config(page_title="Color Season Shopper", page_icon="🎨")
st.title("🎨 Color Season Shopper — MVP Demo")

st.write("Upload a clothing/product image. Drag to crop/zoom around the garment to avoid skin, hair, or background.")

palettes = load_palettes("data/palettes.json")
uploaded = st.file_uploader("Upload an image", type=["jpg","jpeg","png","webp"])

if uploaded:
    # Show original
    original = Image.open(uploaded).convert("RGB")
    st.image(original, caption="Original", use_container_width=True)

    # Interactive cropper (free aspect ratio; you can set aspect_ratio=(3,4) for dresses, etc.)
    st.caption("Tip: zoom with mouse/trackpad, drag the box to isolate the garment.")
    cropped = st_cropper(
        original,
        realtime_update=True,
        box_color='#2E86C1',
        aspect_ratio=None
    )

    # Extract dominant colors from cropped (fallback to original if cropper fails)
    target_img = cropped if isinstance(cropped, Image.Image) else original
    hexes = dominant_hex_colors(target_img, n_colors=5, crop_box=None)

    if hexes:
        st.write("**Dominant HEX colors:**", ", ".join(hexes))

        # Always pick a season; also show top 3 since colors can straddle seasons
        ranking = rank_seasons(hexes, palettes)
        if ranking:
            top3 = ranking[:3]
            primary = top3[0][0]

            st.subheader(f"✅ Best for: {primary}")

            # Optional: show the next-best seasons without numbers
            if len(top3) > 1:
                others = [s for (s, _score) in top3[1:]]
                st.write("**Also works for:** " + " · ".join(others))

            # If you still want to keep scores somewhere, tuck them away:
            with st.expander("Details (color math)", expanded=False):
                st.caption("Lower = closer match in Lab color space (ΔE76).")
                for s, score in top3:
                    st.write(f"- {s}: ~{score:.1f}")
        else:
            st.warning("Couldn’t compute a ranking for this image.")
    else:
        st.warning("No dominant colors detected — try cropping tighter on the garment.")

