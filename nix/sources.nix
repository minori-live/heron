{
  # Upstream inputs only; Heron itself is always built from this checkout.
  pnpm = "sha256-2G6FhRgtd4Mr4c9dO8bRiTbTFbCcbIp0WhGGHO7OXAs=";
  vst3sdk = {
    rev = "9fad9770f2ae8542ab1a548a68c1ad1ac690abe0";
    hash = "sha256-ZGhhFic8l8xDwajTJgZPXl6M+S3QhrDX5zrCSu/Vfvg=";
  };
  araSdk = {
    rev = "0005c532bb03eb210e7bb490329fc6d7ba1792c7";
    hash = "sha256-t4VTZQid9Uks4Y6TgKZOqGmG+Gce7N9d01+1UsMJ5ZY=";
  };
  plugins = {
    x86_64-linux = "sha256-XT1IkTFhq04L5LA+W5GDlHYC63vcwbz3EQ3ERCwNxSY=";
    aarch64-linux = "sha256-AUXZWdINSQ2tk8+jOpudcL848lA7IP7BHirjpRArtjQ=";
  };
}
