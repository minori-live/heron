{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.programs.heron;
in
{
  options.programs.heron = {
    enable = lib.mkEnableOption "Heron digital audio workstation";

    package = lib.mkOption {
      type = lib.types.package;
      default =
        pkgs.heron or (throw ''
          programs.heron.package is unset and pkgs.heron is missing.
          Import heron.homeManagerModules.heron from the Heron flake (it sets the default),
          apply heron.overlays.default, or set programs.heron.package explicitly.
        '');
      defaultText = lib.literalExpression "pkgs.heron";
      description = "Heron package to install.";
    };
  };

  config = lib.mkIf cfg.enable {
    home.packages = [ cfg.package ];
  };
}
