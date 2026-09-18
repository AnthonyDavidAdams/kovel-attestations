const $ = (id) => document.getElementById(id);
(async () => {
  const { settings } = await chrome.runtime.sendMessage({ type: "popup:get" });
  $("repo").value = settings.repo; $("rekor").checked = !!settings.rekor; $("policy").value = settings.policy;
})();
$("save").onclick = async () => {
  await chrome.runtime.sendMessage({ type: "popup:settings", settings: { repo: $("repo").value.trim(), rekor: $("rekor").checked, policy: $("policy").value } });
  $("saved").textContent = "Saved.";
};
