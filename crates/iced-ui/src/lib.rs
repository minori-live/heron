//! Shared iced foundations for Heron's host chrome and built-in plug-ins.

use iced_core::{Color, theme::Palette};
use iced_widget::Theme;

/// Four-pixel spatial scale used by native Heron interfaces.
pub mod space {
    pub const XS: f32 = 4.0;
    pub const SM: f32 = 8.0;
    pub const MD: f32 = 12.0;
    pub const LG: f32 = 16.0;
    pub const XL: f32 = 24.0;
}

/// Dense typography roles used by editor chrome.
pub mod type_size {
    pub const CAPTION: f32 = 11.0;
    pub const CONTROL: f32 = 12.0;
    pub const BODY_COMPACT: f32 = 13.0;
    pub const PANEL_TITLE: f32 = 15.0;
}

/// Resolved application appearance used by host-owned iced surfaces.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Appearance {
    Light,
    #[default]
    Dark,
}

/// Semantic colors corresponding to the renderer design system.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SemanticPalette {
    pub canvas: Color,
    pub canvas_subtle: Color,
    pub surface: Color,
    pub surface_raised: Color,
    pub control: Color,
    pub control_hover: Color,
    pub control_pressed: Color,
    pub text: Color,
    pub text_muted: Color,
    pub text_subtle: Color,
    pub border: Color,
    pub border_strong: Color,
    pub action: Color,
    pub action_hover: Color,
    pub action_pressed: Color,
    pub action_text: Color,
    pub selection: Color,
    pub selection_hover: Color,
    pub selection_border: Color,
    pub focus: Color,
    pub success: Color,
    pub warning: Color,
    pub danger: Color,
    pub audio: Color,
    pub midi: Color,
}

impl Appearance {
    /// Resolve the complete semantic palette for this appearance.
    #[must_use]
    pub const fn palette(self) -> SemanticPalette {
        match self {
            Self::Dark => {
                let surface = rgb(0x1d2128);
                let action = rgb(0x8da8b5);
                let border = rgb(0x383e48);
                SemanticPalette {
                    canvas: rgb(0x0e1014),
                    canvas_subtle: rgb(0x171a20),
                    surface,
                    surface_raised: rgb(0x252a32),
                    control: rgb(0x252a32),
                    control_hover: rgb(0x383e48),
                    control_pressed: rgb(0x171a20),
                    text: rgb(0xf6f7f9),
                    text_muted: rgb(0xaeb4bf),
                    text_subtle: rgb(0x8d95a2),
                    border: rgb(0x383e48),
                    border_strong: rgb(0x515966),
                    action,
                    action_hover: rgb(0xb6cbd3),
                    action_pressed: rgb(0x6f929f),
                    action_text: rgb(0x0e1014),
                    selection: mix(action, 0.14, surface),
                    selection_hover: mix(action, 0.20, surface),
                    selection_border: mix(action, 0.72, border),
                    focus: rgb(0x8eb9c8),
                    success: rgb(0x59d79a),
                    warning: rgb(0xf4bd62),
                    danger: rgb(0xff6b72),
                    audio: rgb(0x58c6c2),
                    midi: rgb(0xad8cff),
                }
            }
            Self::Light => {
                let surface = rgb(0xececee);
                let action = rgb(0x456d7a);
                let border = rgb(0xc4c5c7);
                SemanticPalette {
                    canvas: rgb(0xd8d9db),
                    canvas_subtle: rgb(0xe4e5e7),
                    surface,
                    surface_raised: rgb(0xf3f3f4),
                    control: rgb(0xe8e8e9),
                    control_hover: rgb(0xf2f2f3),
                    control_pressed: rgb(0xc8d0d4),
                    text: rgb(0x202224),
                    text_muted: rgb(0x676c70),
                    text_subtle: rgb(0x858a8e),
                    border: rgb(0xc4c5c7),
                    border_strong: rgb(0xaaadb0),
                    action,
                    action_hover: rgb(0x355d6b),
                    action_pressed: rgb(0x365e6b),
                    action_text: Color::WHITE,
                    selection: mix(action, 0.12, surface),
                    selection_hover: mix(action, 0.18, surface),
                    selection_border: mix(action, 0.72, border),
                    focus: rgb(0x2f758b),
                    success: rgb(0x16764c),
                    warning: rgb(0x8a5700),
                    danger: rgb(0xb4232d),
                    audio: rgb(0x167a77),
                    midi: rgb(0x704fc0),
                }
            }
        }
    }

    /// Build an iced theme with Heron's semantic base colors.
    #[must_use]
    pub fn theme(self) -> Theme {
        let colors = self.palette();
        Theme::custom(
            match self {
                Self::Dark => "Heron Dark",
                Self::Light => "Heron Light",
            },
            Palette {
                background: colors.canvas,
                text: colors.text,
                primary: colors.action,
                success: colors.success,
                warning: colors.warning,
                danger: colors.danger,
            },
        )
    }
}

/// Build an opaque color from a `0xRRGGBB` literal.
const fn rgb(value: u32) -> Color {
    Color::from_rgb8(
        ((value >> 16) & 0xff) as u8,
        ((value >> 8) & 0xff) as u8,
        (value & 0xff) as u8,
    )
}

/// Blend `foreground` over `background` by `amount` in linear component space.
const fn mix(foreground: Color, amount: f32, background: Color) -> Color {
    let inverse = 1.0 - amount;
    Color {
        r: foreground.r * amount + background.r * inverse,
        g: foreground.g * amount + background.g * inverse,
        b: foreground.b * amount + background.b * inverse,
        a: foreground.a * amount + background.a * inverse,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appearances_keep_distinct_surface_and_text_colors() {
        for appearance in [Appearance::Dark, Appearance::Light] {
            let palette = appearance.palette();
            assert_ne!(palette.canvas, palette.surface);
            assert_ne!(palette.surface, palette.text);
            assert_ne!(palette.control, palette.action);
        }
    }
}
