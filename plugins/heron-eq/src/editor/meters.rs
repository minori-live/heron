use super::EqMessage;
use truce_iced::{
    Message,
    iced::{
        Border, Element,
        widget::{Row, progress_bar},
    },
};

/// Actual reported stereo peak levels, on a conventional -60..0 dB scale.
pub fn stereo(peaks: [f32; 2]) -> Element<'static, Message<EqMessage>> {
    let colors = heron_plugin_ui::palette();
    let mut bars = Row::new().spacing(3);
    for peak in peaks {
        let level = (super::peak_db(peak) + 60.0).clamp(0.0, 60.0);
        bars = bars.push(
            progress_bar(0.0..=60.0, level)
                .vertical()
                .length(30)
                .girth(6)
                .style(move |_| progress_bar::Style {
                    background: colors.control.into(),
                    bar: if peak > 1.0 {
                        colors.danger
                    } else {
                        colors.audio
                    }
                    .into(),
                    border: Border {
                        radius: 2.0.into(),
                        ..Default::default()
                    },
                }),
        );
    }
    bars.into()
}
