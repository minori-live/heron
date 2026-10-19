//! Low-level FFI bindings for the vendored Rubber Band Library.
//!
//! Generated at build time from `vendor/rubberband/rubberband/rubberband-c.h`.

#![allow(
    non_camel_case_types,
    non_snake_case,
    non_upper_case_globals,
    improper_ctypes
)]

include!(concat!(env!("OUT_DIR"), "/bindings.rs"));
