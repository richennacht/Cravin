// Point the download button straight at the latest release's Windows
// installer. If the API call fails or there's no release yet, the button
// keeps its fallback href (the releases/latest page).
(async () => {
  const button = document.getElementById("download");
  const meta = document.getElementById("download-meta");

  try {
    const res = await fetch(
      "https://api.github.com/repos/richennacht/cravin/releases/latest",
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const release = await res.json();
    const assets = release.assets || [];

    const pick =
      assets.find((a) => /x64.*-setup\.exe$/i.test(a.name)) ||
      assets.find((a) => /\.exe$/i.test(a.name) && !/arm64/i.test(a.name)) ||
      assets.find((a) => /x64.*\.msi$/i.test(a.name));
    if (!pick) throw new Error("no Windows installer in latest release");

    button.href = pick.browser_download_url;
    const mb = (pick.size / 1024 / 1024).toFixed(0);
    meta.textContent = `${release.tag_name} · ${mb} MB · Windows 10 and 11, 64-bit`;
  } catch (err) {
    console.warn("Falling back to the releases page:", err);
  }
})();
