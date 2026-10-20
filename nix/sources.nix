{
  # Upstream inputs only; Heron itself is always built from this checkout.
  # Built-in plug-in archive hashes live in heron-plugins.lock.json.
  pnpm = "sha256-Sm4A5YqC0hwr1iXRbJjrTMKY4J5Se1QaysKQenVO7RQ=";
  vst3sdk = {
    rev = "9fad9770f2ae8542ab1a548a68c1ad1ac690abe0";
    hash = "sha256-ZGhhFic8l8xDwajTJgZPXl6M+S3QhrDX5zrCSu/Vfvg=";
  };
  araSdk = {
    rev = "0005c532bb03eb210e7bb490329fc6d7ba1792c7";
    hash = "sha256-t4VTZQid9Uks4Y6TgKZOqGmG+Gce7N9d01+1UsMJ5ZY=";
  };
}
