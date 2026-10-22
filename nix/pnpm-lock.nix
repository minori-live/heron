# Each registry package in pnpm-lock.yaml is its own fixed-output fetch.
# The integrity hash is the lockfile entry, so a lockfile update does not
# need a separate pin in nix/sources.nix. Cargo already uses cargoLock.
{
  lib,
  fetchurl,
  writeText,
}:
let
  lockText = builtins.readFile ../pnpm-lock.yaml;
  packagesSection =
    let
      afterPackages = lib.splitString "\npackages:\n" lockText;
      rest = builtins.elemAt afterPackages 1;
      untilSnapshots = lib.splitString "\nsnapshots:\n" rest;
    in
    if builtins.length afterPackages != 2 then
      throw "pnpm-lock.yaml is missing a single packages section"
    else if builtins.length untilSnapshots < 2 then
      throw "pnpm-lock.yaml is missing a snapshots section"
    else
      builtins.head untilSnapshots;

  parsed =
    let
      step =
        acc: line:
        let
          isPackageKey =
            lib.hasPrefix "  " line && !lib.hasPrefix "   " line && lib.hasSuffix ":" line && line != "";
          isResolution = lib.hasPrefix "    resolution: {integrity: " line && lib.hasSuffix "}" line;
          spec =
            let
              raw = lib.removeSuffix ":" (lib.removePrefix "  " line);
            in
            if lib.hasPrefix "'" raw then lib.removePrefix "'" (lib.removeSuffix "'" raw) else raw;
          integrity = lib.removeSuffix "}" (lib.removePrefix "    resolution: {integrity: " line);
        in
        if isPackageKey then
          if acc.pending != null then
            throw "pnpm package ${acc.pending} has no integrity"
          else
            acc // { pending = spec; }
        else if isResolution then
          if acc.pending == null then
            throw "pnpm integrity without a package name: ${line}"
          else if !lib.hasPrefix "sha512-" integrity then
            throw "pnpm package ${acc.pending} has unsupported integrity ${integrity}"
          else
            acc
            // {
              pending = null;
              found = [
                {
                  inherit integrity;
                  spec = acc.pending;
                }
              ]
              ++ acc.found;
            }
        else
          acc;
      result = lib.foldl' step {
        pending = null;
        found = [ ];
      } (lib.splitString "\n" packagesSection);
    in
    if result.pending != null then
      throw "pnpm package ${result.pending} has no integrity"
    else if result.found == [ ] then
      throw "pnpm-lock.yaml packages section has no registry packages"
    else
      result.found;

  packageFromSpec =
    { spec, integrity }:
    let
      parts = lib.splitString "@" spec;
      version = lib.last parts;
      name = lib.concatStringsSep "@" (lib.init parts);
      tarballName = lib.last (lib.splitString "/" name);
      # Derivation names cannot contain the characters used in scoped package names.
      safe = builtins.replaceStrings [ "/" "@" ] [ "-" "" ] "${name}-${version}";
    in
    if name == "" || version == "" then
      throw "pnpm package spec ${spec} is not name@version"
    else
      {
        inherit
          name
          version
          integrity
          ;
        src = fetchurl {
          name = "pnpm-${safe}.tgz";
          url = "https://registry.npmjs.org/${name}/-/${tarballName}-${version}.tgz";
          hash = integrity;
        };
      };

  packages = map packageFromSpec parsed;

  grouped = lib.foldl' (
    acc: pkg:
    acc
    // {
      ${pkg.name} = (acc.${pkg.name} or { }) // {
        ${pkg.version} = {
          inherit (pkg) integrity;
          tarball = "${pkg.src}";
        };
      };
    }
  ) { } packages;
in
{
  manifest = writeText "heron-pnpm-lock-sources.json" (builtins.toJSON grouped);
}
