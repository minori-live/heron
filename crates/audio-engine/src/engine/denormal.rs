//! Flush subnormal floats for the duration of an audio callback.
//!
//! Quiet tails and decaying plug-in state produce subnormals. On x86_64 those
//! values fall into microcode and can make a mix tens of times slower. FTZ+DAZ
//! (and AArch64 FZ) turn that work back into ordinary arithmetic. Nested guards
//! restore the previous control register, so a callback guard and a render
//! guard can stack.

#[must_use = "denormal flushing ends when the guard drops"]
pub(super) struct DenormalGuard {
    #[cfg(target_arch = "x86_64")]
    previous: u32,
    #[cfg(target_arch = "aarch64")]
    previous: u64,
}

impl DenormalGuard {
    #[inline]
    pub(super) fn enter() -> Self {
        #[cfg(target_arch = "x86_64")]
        {
            // FTZ is MXCSR bit 15. DAZ is MXCSR bit 6.
            const FTZ_DAZ: u32 = 0x8040;
            let previous = read_mxcsr();
            write_mxcsr(previous | FTZ_DAZ);
            Self { previous }
        }
        #[cfg(target_arch = "aarch64")]
        {
            // FZ (bit 24) flushes denormal inputs and outputs to zero.
            const FZ: u64 = 1 << 24;
            let previous = read_fpcr();
            write_fpcr(previous | FZ);
            Self { previous }
        }
        #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
        {
            Self {}
        }
    }
}

impl Drop for DenormalGuard {
    fn drop(&mut self) {
        #[cfg(target_arch = "x86_64")]
        write_mxcsr(self.previous);
        #[cfg(target_arch = "aarch64")]
        write_fpcr(self.previous);
    }
}

#[cfg(target_arch = "x86_64")]
fn read_mxcsr() -> u32 {
    let mut mxcsr = 0u32;
    // SAFETY: `stmxcsr` stores this thread's MXCSR into the live stack slot.
    // The asm is treated as touching memory, so the read below observes it.
    unsafe {
        std::arch::asm!(
            "stmxcsr [{mxcsr}]",
            mxcsr = in(reg) &raw mut mxcsr,
            options(nostack, preserves_flags)
        );
    }
    mxcsr
}

#[cfg(target_arch = "x86_64")]
fn write_mxcsr(mxcsr: u32) {
    // SAFETY: `ldmxcsr` replaces this thread's MXCSR with `mxcsr`. Callers
    // pass either the value just read or that value with FTZ and DAZ set.
    unsafe {
        std::arch::asm!(
            "ldmxcsr [{mxcsr}]",
            mxcsr = in(reg) &raw const mxcsr,
            options(nostack, preserves_flags)
        );
    }
}

#[cfg(target_arch = "aarch64")]
fn read_fpcr() -> u64 {
    let fpcr: u64;
    // SAFETY: `mrs` reads this thread's FPCR into a register. `nomem` is
    // omitted so the compiler cannot move buffer loads or stores across the
    // control-register access.
    unsafe {
        std::arch::asm!(
            "mrs {fpcr}, fpcr",
            fpcr = out(reg) fpcr,
            options(nostack, preserves_flags)
        );
    }
    fpcr
}

#[cfg(target_arch = "aarch64")]
fn write_fpcr(fpcr: u64) {
    // SAFETY: `msr` writes this thread's FPCR. Callers pass either the value
    // just read, or that value with the documented FZ bit set. `nomem` is
    // omitted so floating-point buffer traffic cannot move outside the guard.
    unsafe {
        std::arch::asm!(
            "msr fpcr, {fpcr}",
            fpcr = in(reg) fpcr,
            options(nostack, preserves_flags)
        );
    }
}
