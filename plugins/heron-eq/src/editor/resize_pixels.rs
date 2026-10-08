//! Compare actual native GPU paint against the bounds used for mouse hit testing.

use super::*;
use truce_iced::iced::widget::core;

fn near(actual: &[u8], expected: [u8; 3], tolerance: u8) -> bool {
    actual
        .iter()
        .zip(expected)
        .all(|(left, right)| left.abs_diff(right) <= tolerance)
}

pub(super) fn verify(
    renderer: &mut Renderer,
    size: Size,
    label: &str,
    hud: Rectangle,
    power: Rectangle,
    enabled: bool,
) -> serde_json::Value {
    let width = size.width as u32;
    let height = size.height as u32;
    let image = core::renderer::Headless::screenshot(
        renderer,
        Size::new(width, height),
        1.0,
        style::palette().canvas,
    );
    assert_eq!(image.len(), width as usize * height as usize * 4);
    let pixel = |x: u32, y: u32| {
        let index = ((y * width + x) * 4) as usize;
        &image[index..index + 3]
    };

    // A bottom interior row is background across the selected HUD. It carries
    // no controls, curve or axis ink, so its actual long run witnesses placement.
    let row = (hud.y + hud.height - 4.0).round() as u32;
    let mut longest = (0, 0);
    let mut start = None;
    for x in 0..width {
        if near(pixel(x, row), [43, 43, 46], 2) {
            start.get_or_insert(x);
        } else if let Some(left) = start.take()
            && x - left > longest.1 - longest.0
        {
            longest = (left, x);
        }
    }
    if let Some(left) = start
        && width - left > longest.1 - longest.0
    {
        longest = (left, width);
    }
    assert!(
        (longest.0 as f32 - hud.x).abs() <= 8.0,
        "GPU HUD left edge disagrees with hit bounds at {size:?}: {longest:?} vs {hud:?}"
    );
    assert!(
        (longest.1 as f32 - hud.x - hud.width).abs() <= 8.0,
        "GPU HUD right edge disagrees with hit bounds at {size:?}: {longest:?} vs {hud:?}"
    );

    let color = if enabled {
        [238, 226, 175]
    } else {
        [229, 228, 223]
    };
    let mut ink = None;
    for y in power.y.floor() as u32..(power.y + power.height).ceil() as u32 {
        for x in power.x.floor() as u32..(power.x + power.width).ceil() as u32 {
            if near(pixel(x, y), color, 24) {
                let bounds = ink.get_or_insert([x, y, x, y]);
                bounds[0] = bounds[0].min(x);
                bounds[1] = bounds[1].min(y);
                bounds[2] = bounds[2].max(x);
                bounds[3] = bounds[3].max(y);
            }
        }
    }
    let ink = ink.expect("the actual GPU power icon must be inside its mouse hit rectangle");
    assert!(((ink[0] + ink[2]) as f32 * 0.5 - power.center_x()).abs() <= 3.0);
    assert!(((ink[1] + ink[3]) as f32 * 0.5 - power.center_y()).abs() <= 3.0);
    let kind = if label == "resized-popup-close" {
        "popup"
    } else {
        "controls"
    };
    let path = std::path::PathBuf::from(format!(
        "../../out/eq-native/resize-{width}x{height}-{kind}.png"
    ));
    truce::core::screenshot::save_png(&path, &image, width, height);
    serde_json::json!({
        "hud_background_row": [row, longest.0, longest.1],
        "power_ink_bounds": ink,
        "file": path.file_name().unwrap().to_string_lossy(),
        "scale": 1,
    })
}
