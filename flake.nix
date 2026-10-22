{
  description = "Heron digital audio workstation";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # nixos-unstable dropped the x86_64-darwin toolchain. 26.05 is the last
    # release that still builds Rust, Node, and Electron for Intel Macs.
    nixpkgs-intel-darwin.url = "github:NixOS/nixpkgs/nixpkgs-26.05-darwin";
  };

  outputs =
    {
      self,
      nixpkgs,
      nixpkgs-intel-darwin,
    }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor =
        system:
        if system == "x86_64-darwin" then
          nixpkgs-intel-darwin.legacyPackages.${system}
        else
          nixpkgs.legacyPackages.${system};
      packageFor =
        system:
        let
          pkgs = pkgsFor system;
        in
        pkgs.callPackage ./nix/package.nix { inherit pkgs; };
    in
    {
      packages = forAllSystems (system: {
        heron = packageFor system;
        default = packageFor system;
      });

      apps = forAllSystems (system: {
        heron = {
          type = "app";
          program = "${self.packages.${system}.heron}/bin/heron";
        };
        default = self.apps.${system}.heron;
      });

      overlays.default = final: _prev: {
        heron = final.callPackage ./nix/package.nix { pkgs = final; };
      };

      nixosModules.default =
        {
          lib,
          pkgs,
          ...
        }:
        {
          imports = [ ./nix/module.nix ];
          programs.heron.package = lib.mkDefault self.packages.${pkgs.stdenv.hostPlatform.system}.heron;
        };
      nixosModules.heron = self.nixosModules.default;

      darwinModules.default =
        {
          lib,
          pkgs,
          ...
        }:
        {
          imports = [ ./nix/darwin-module.nix ];
          programs.heron.package = lib.mkDefault self.packages.${pkgs.stdenv.hostPlatform.system}.heron;
        };
      darwinModules.heron = self.darwinModules.default;

      homeManagerModules.default =
        {
          lib,
          pkgs,
          ...
        }:
        {
          imports = [ ./nix/home-manager.nix ];
          programs.heron.package = lib.mkDefault self.packages.${pkgs.stdenv.hostPlatform.system}.heron;
        };
      homeManagerModules.heron = self.homeManagerModules.default;

      checks = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          heron = self.packages.${system}.heron;
          darwin-module = import ./nix/darwin-module-check.nix {
            inherit (nixpkgs) lib;
            inherit pkgs;
            module = self.darwinModules.heron;
          };
        }
      );

      # Packaging helpers only. Application development uses the mise toolchain.
      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          default = pkgs.mkShellNoCC {
            packages = [ pkgs.nixfmt ];
          };
        }
      );

      formatter = forAllSystems (system: (pkgsFor system).nixfmt);
    };
}
