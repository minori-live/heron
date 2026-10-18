use std::{env, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let rubberband_root = manifest_dir.join("vendor/rubberband");
    let single_cpp = rubberband_root.join("single/RubberBandSingle.cpp");
    let header = rubberband_root.join("rubberband/rubberband-c.h");

    println!("cargo:rerun-if-changed={}", single_cpp.display());
    println!("cargo:rerun-if-changed={}", header.display());

    let mut build = cc::Build::new();
    build.cpp(true).file(&single_cpp);

    // Prefer g++ on Linux when the default `c++` is a Clang that lacks libstdc++
    // headers (common on some agent images). CI Ubuntu runners already use g++.
    if env::var_os("CXX").is_none() && cfg!(target_os = "linux") {
        build.compiler("g++");
    }

    if cfg!(target_os = "macos") || cfg!(target_os = "ios") {
        println!("cargo:rustc-link-lib=framework=Accelerate");
    }

    if cfg!(target_os = "macos") {
        let min = if cfg!(target_arch = "aarch64") {
            "11.0"
        } else {
            "10.13"
        };
        build.flag(format!("-mmacos-version-min={min}"));
    }

    if cfg!(target_os = "windows") {
        build
            .define("_WIN32", None)
            .define("NOMINMAX", None)
            .define("_USE_MATH_DEFINES", None)
            .define("GETOPT_API", "");
    } else {
        build
            .define("USE_PTHREADS", None)
            .define("HAVE_POSIX_MEMALIGN", None);
        build.flag_if_supported("-std=c++14");
        build.flag_if_supported("-Wno-unused-parameter");
    }

    build.compile("heron_rubberband");

    let bindings = bindgen::Builder::default()
        .header(header.to_string_lossy())
        .allowlist_function("rubberband_.*")
        .allowlist_type("RubberBand.*")
        .allowlist_var("RUBBERBAND_.*")
        .allowlist_var("RubberBandOption_.*")
        .clang_arg(format!("-I{}", rubberband_root.display()))
        .parse_callbacks(Box::new(bindgen::CargoCallbacks::new()))
        .generate()
        .expect("Unable to generate Rubber Band bindings");

    let out_path = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    bindings
        .write_to_file(out_path.join("bindings.rs"))
        .expect("Couldn't write Rubber Band bindings");
}
