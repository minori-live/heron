{
  lib,
  pkgs,
  module,
}:
let
  eval =
    enable:
    lib.evalModules {
      specialArgs = { inherit pkgs; };
      modules = [
        module
        {
          programs.heron.enable = enable;
          programs.heron.package = pkgs.hello;
        }
        (
          { lib, ... }:
          {
            options.environment.systemPackages = lib.mkOption {
              type = lib.types.listOf lib.types.raw;
              default = [ ];
            };
          }
        )
      ];
    };
  enabled = eval true;
  disabled = eval false;
in
pkgs.runCommand "heron-darwin-module" { } ''
  test ${toString (builtins.length disabled.config.environment.systemPackages)} -eq 0
  test ${toString (builtins.length enabled.config.environment.systemPackages)} -eq 1
  test "${lib.elemAt enabled.config.environment.systemPackages 0}" = "${pkgs.hello}"
  touch "$out"
''
