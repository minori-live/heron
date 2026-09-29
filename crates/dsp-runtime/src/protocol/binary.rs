use serde::{Deserialize, Serialize};

/// A binary payload carried inside one native control message.
///
/// The embedded runtime decodes MessagePack in-process, so the inline form is
/// the only one Heron produces. The shared and attachment forms remain
/// decodable so a payload that still carries the removed helper-process
/// transport encoding is rejected with a typed error instead of a decode
/// failure.
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "storage", rename_all = "kebab-case")]
pub enum BinaryPayload {
    Inline {
        #[serde(with = "serde_bytes")]
        #[cfg_attr(feature = "ts-export", ts(type = "Uint8Array"))]
        bytes: Vec<u8>,
    },
    Shared {
        reference: SharedBlobRef,
    },
    Attachment {
        index: u16,
        offset: u64,
        length: u64,
    },
}

/// Identity of a region in the removed shared-memory transport. Retained so a
/// stale payload that references one fails with a typed rejection.
#[cfg_attr(feature = "ts-export", derive(ts_rs::TS))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SharedBlobRef {
    pub session_epoch: u64,
    pub region_id: u32,
    pub region_generation: u64,
    pub slot: u16,
    pub allocation_generation: u64,
    pub offset: u64,
    pub length: u64,
    pub lease_id: u64,
}

impl Default for BinaryPayload {
    fn default() -> Self {
        Self::inline(Vec::new())
    }
}

impl BinaryPayload {
    #[must_use]
    pub fn inline(bytes: Vec<u8>) -> Self {
        Self::Inline { bytes }
    }

    #[must_use]
    pub fn as_inline(&self) -> Option<&[u8]> {
        match self {
            Self::Inline { bytes } => Some(bytes),
            Self::Shared { .. } | Self::Attachment { .. } => None,
        }
    }
}
