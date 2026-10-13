{
  description = "Heron digital audio workstation";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      packageFor = system: nixpkgs.legacyPackages.${system}.callPackage ./nix/package.nix { };
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
        heron = final.callPackage ./nix/package.nix { };
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

      checks = forAllSystems (system: {
        heron = self.packages.${system}.heron;
      });

      # Packaging helpers only. Application development uses the mise toolchain.
      devShells = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShellNoCC {
            packages = [ pkgs.nixfmt ];
          };
        }
      );

      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt);
    };
}
