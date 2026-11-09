chrome.runtime.sendMessage({ type: "status" }).then((status) => {
    if (!status || !status.ok) return;
    document.getElementById("version").textContent = `v${status.version}`;
    const list = document.getElementById("origins");
    for (const origin of status.origins) {
        const item = document.createElement("li");
        item.textContent = origin;
        list.appendChild(item);
    }
});
