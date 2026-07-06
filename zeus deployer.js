// ============================================================
// FILE: zeus deployer.js (Royal Gateway - Deployer Worker)
// ============================================================

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		if (request.method === "GET" && url.pathname === "/") {
			return new Response(getHtmlContent(), {
				headers: { "Content-Type": "text/html;charset=UTF-8" },
			});
		}
		if (request.method === "POST" && url.pathname === "/api/deploy") {
			try {
				const { token } = await request.json();
				if (!token) throw new Error("توکن نمی‌تواند خالی باشد.");
				const headers = {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				};
				const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers });
				const accData = await accRes.json();
				if (!accData.success || accData.result.length === 0) {
					throw new Error("فقط با دکمه نارنجی «دریافت توکن» توکن بسازید.");
				}
				const accountId = accData.result[0].id;
				let devSub = null;
				const subRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, { headers });
				const subData = await subRes.json();
				if (subData.success && subData.result && subData.result.subdomain) {
					devSub = subData.result.subdomain;
				} else {
					const newSub = `royal-${Math.random().toString(36).substring(2, 8)}`;
					const createSub = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
						method: "PUT",
						headers,
						body: JSON.stringify({ subdomain: newSub }),
					});
					const createSubData = await createSub.json();
					if (!createSubData.success) {
						const cfError = createSubData.errors && createSubData.errors.length > 0 ? createSubData.errors[0].message : "نامشخص";
						throw new Error(`CF_TOS_ERROR|${cfError}`);
					}
					devSub = newSub;
				}
				const uniqueSuffix = Math.random().toString(36).substring(2, 8);
				const workerName = `royal-panel-${uniqueSuffix}`;
				const dbName = `royal-db-${uniqueSuffix}`;
				const dbRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, {
					method: "POST",
					headers,
					body: JSON.stringify({ name: dbName }),
				});
				const dbData = await dbRes.json();
				if (!dbData.success) {
					const cfError = dbData.errors && dbData.errors.length > 0 ? dbData.errors[0].message : "نامشخص";
					throw new Error(`CF_DB_ERROR|${cfError}`);
				}
				const dbUuid = dbData.result.uuid;
				await new Promise((resolve) => setTimeout(resolve, 1000));
				// >>> استفاده از مخزن جدید Royal-panel
				const githubRes = await fetch("https://raw.githubusercontent.com/amir52534/Royal-panel/refs/heads/main/zeus.js?t=" + Date.now());
				if (!githubRes.ok) throw new Error("خطا در دریافت سورس از گیت‌هاب.");
				const zeusCode = await githubRes.text();
				// ================================================
				const metadata = {
					main_module: "zeus.js",
					compatibility_date: "2024-02-08",
					bindings: [
						{ type: "d1", name: "DB", id: dbUuid },
						{ type: "secret_text", name: "CF_API_TOKEN", text: token },
						{ type: "secret_text", name: "CF_ACCOUNT_ID", text: accountId },
					],
				};
				const formData = new FormData();
				formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
				formData.append("zeus.js", new Blob([zeusCode], { type: "application/javascript+module" }), "zeus.js");
				const deployRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`, {
					method: "PUT",
					headers: { Authorization: `Bearer ${token}` },
					body: formData,
				});
				const deployData = await deployRes.json();
				if (!deployData.success) {
					const cfError = deployData.errors && deployData.errors.length > 0 ? deployData.errors[0].message : "نامشخص";
					throw new Error(`CF_DEPLOY_ERROR|${cfError}`);
				}
				const routeRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/subdomain`, {
					method: "POST",
					headers,
					body: JSON.stringify({ enabled: true }),
				});
				if (!routeRes.ok) throw new Error("خطا در فعال‌سازی لینک نهایی.");
				const finalUrl = `https://${workerName}.${devSub}.workers.dev/panel`;
				return new Response(JSON.stringify({ success: true, url: finalUrl }), {
					headers: { "Content-Type": "application/json" },
				});
			} catch (error) {
				return new Response(JSON.stringify({ success: false, error: error.message }), {
					status: 400,
					headers: { "Content-Type": "application/json" },
				});
			}
		}
		if (request.method === "POST" && url.pathname === "/api/list-panels") {
			try {
				const { token } = await request.json();
				if (!token) throw new Error("Token cannot be empty");
				const headers = {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				};
				const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers });
				const accData = await accRes.json();
				if (!accData.success || accData.result.length === 0) {
					throw new Error("Account not found");
				}
				const accountId = accData.result[0].id;
				const subRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, { headers });
				const subData = await subRes.json();
				const devSub = subData.success && subData.result && subData.result.subdomain ? subData.result.subdomain : "";
				const scriptsRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`, { headers });
				const scriptsData = await scriptsRes.json();
				if (!scriptsData.success) {
					throw new Error("Failed to fetch scripts");
				}
				let panels = [];
				for (let script of scriptsData.result) {
					if (script.id.startsWith("royal-panel") || script.id.startsWith("ez-")) {
						panels.push({ name: script.id });
					}
				}
				let latestVersion = "Unknown";
				try {
					const ghRes = await fetch("https://raw.githubusercontent.com/amir52534/Royal-panel/main/zeus.js?t=" + Date.now());
					if (ghRes.ok) {
						const ghText = await ghRes.text();
						const match = ghText.match(/CURRENT_VERSION\s*=\s*['"]([0-9\.]+)['"]/i);
						if (match && match[1]) latestVersion = "v" + match[1];
					}
				} catch (e) {}
				return new Response(JSON.stringify({ success: true, panels, latestVersion, devSub }), {
					headers: { "Content-Type": "application/json" },
				});
			} catch (error) {
				return new Response(JSON.stringify({ success: false, error: error.message }), {
					status: 400,
					headers: { "Content-Type": "application/json" },
				});
			}
		}
		if (request.method === "POST" && url.pathname === "/api/get-panel-version") {
			try {
				const { token, scriptName } = await request.json();
				const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
				const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers });
				const accData = await accRes.json();
				const accountId = accData.result[0].id;
				const contentRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}`, { headers });
				const contentText = await contentRes.text();
				let version = "Unknown";
				const varMatch = contentText.match(/CURRENT_VERSION\s*=\s*['"]([0-9\.]+)['"]/i);
				if (varMatch && varMatch[1]) {
					version = "v" + varMatch[1];
				} else {
					const spanMatch = contentText.match(/id=["']panel-version["'][^>]*>\s*v?([0-9\.]+)\s*<\/span>/i);
					if (spanMatch && spanMatch[1]) {
						version = "v" + spanMatch[1];
					}
				}
				return new Response(JSON.stringify({ success: true, version }), { headers: { "Content-Type": "application/json" } });
			} catch (e) {
				return new Response(JSON.stringify({ success: false, version: "Unknown" }), { headers: { "Content-Type": "application/json" } });
			}
		}
		if (request.method === "POST" && url.pathname === "/api/do-update") {
			try {
				const { token, scriptName } = await request.json();
				if (!token || !scriptName) throw new Error("Token or script name missing");
				const headers = {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				};
				const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers });
				const accData = await accRes.json();
				if (!accData.success || accData.result.length === 0) {
					throw new Error("Account not found");
				}
				const accountId = accData.result[0].id;
				// >>> استفاده از مخزن جدید Royal-panel
				const githubRes = await fetch("https://raw.githubusercontent.com/amir52534/Royal-panel/refs/heads/main/zeus.js?t=" + Date.now());
				if (!githubRes.ok) throw new Error("Failed to fetch source from GitHub");
				const newCode = await githubRes.text();
				// ================================================
				const bindingsRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/bindings`, { headers });
				const bindingsData = await bindingsRes.json();
				if (!bindingsData.success) throw new Error("Failed to fetch bindings");
				const newBindings = [];
				for (const b of bindingsData.result) {
					if (b.type === "d1") {
						newBindings.push({ type: "d1", name: b.name, id: b.database_id || b.id });
					} else if (b.name === "CF_API_TOKEN") {
						newBindings.push({ type: "secret_text", name: "CF_API_TOKEN", text: token });
					} else if (b.name === "CF_ACCOUNT_ID") {
						newBindings.push({ type: "secret_text", name: "CF_ACCOUNT_ID", text: accountId });
					}
				}
				const metadata = {
					main_module: "zeus.js",
					compatibility_date: "2024-02-08",
					bindings: newBindings,
				};
				const formData = new FormData();
				formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
				formData.append("zeus.js", new Blob([newCode], { type: "application/javascript+module" }), "zeus.js");
				const deployRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}`, {
					method: "PUT",
					headers: { Authorization: `Bearer ${token}` },
					body: formData,
				});
				const deployData = await deployRes.json();
				if (!deployData.success) {
					const cfError = deployData.errors && deployData.errors.length > 0 ? deployData.errors[0].message : "Unknown error";
					throw new Error(cfError);
				}
				return new Response(JSON.stringify({ success: true }), {
					headers: { "Content-Type": "application/json" },
				});
			} catch (error) {
				return new Response(JSON.stringify({ success: false, error: error.message }), {
					status: 400,
					headers: { "Content-Type": "application/json" },
				});
			}
		}
		if (request.method === "POST" && url.pathname === "/api/reset-password") {
			try {
				const { token, scriptName } = await request.json();
				if (!token || !scriptName) throw new Error("Token or script name missing");
				const headers = {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				};
				const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers });
				const accData = await accRes.json();
				if (!accData.success || accData.result.length === 0) {
					throw new Error("Account not found");
				}
				const accountId = accData.result[0].id;
				const bindingsRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/bindings`, { headers });
				const bindingsData = await bindingsRes.json();
				if (!bindingsData.success) throw new Error("Failed to fetch bindings");
				const dbBinding = bindingsData.result.find((b) => b.type === "d1");
				if (!dbBinding) throw new Error("D1 binding not found");
				const dbId = dbBinding.database_id || dbBinding.id;
				const queryRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`, {
					method: "POST",
					headers,
					body: JSON.stringify({ sql: "DELETE FROM settings WHERE key = 'panel_password'" }),
				});
				const queryData = await queryRes.json();
				if (!queryData.success) {
					throw new Error("Database query failed");
				}
				// >>> استفاده از مخزن جدید Royal-panel برای ری‌استارت
				const githubRes = await fetch("https://raw.githubusercontent.com/amir52534/Royal-panel/refs/heads/main/zeus.js?t=" + Date.now());
				if (!githubRes.ok) throw new Error("Failed to fetch source from GitHub");
				const newCode = await githubRes.text();
				// ================================================
				const newBindings = [];
				for (const b of bindingsData.result) {
					if (b.type === "d1") {
						newBindings.push({ type: "d1", name: b.name, id: b.database_id || b.id });
					} else if (b.name === "CF_API_TOKEN") {
						newBindings.push({ type: "secret_text", name: "CF_API_TOKEN", text: token });
					} else if (b.name === "CF_ACCOUNT_ID") {
						newBindings.push({ type: "secret_text", name: "CF_ACCOUNT_ID", text: accountId });
					}
				}
				if (!newBindings.some(b => b.name === "CF_API_TOKEN")) {
					newBindings.push({ type: "secret_text", name: "CF_API_TOKEN", text: token });
				}
				if (!newBindings.some(b => b.name === "CF_ACCOUNT_ID")) {
					newBindings.push({ type: "secret_text", name: "CF_ACCOUNT_ID", text: accountId });
				}
				const metadata = {
					main_module: "zeus.js",
					compatibility_date: "2024-02-08",
					bindings: newBindings,
				};
				const formData = new FormData();
				formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
				formData.append("zeus.js", new Blob([newCode], { type: "application/javascript+module" }), "zeus.js");
				const deployRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}`, {
					method: "PUT",
					headers: { Authorization: `Bearer ${token}` },
					body: formData,
				});
				const deployData = await deployRes.json();
				if (!deployData.success) {
					throw new Error("Failed to restart worker");
				}
				return new Response(JSON.stringify({ success: true }), {
					headers: { "Content-Type": "application/json" },
				});
			} catch (error) {
				return new Response(JSON.stringify({ success: false, error: error.message }), {
					status: 400,
					headers: { "Content-Type": "application/json" },
				});
			}
		}
		if (request.method === "POST" && url.pathname === "/api/delete-panel") {
			try {
				const { token, scriptName } = await request.json();
				if (!token || !scriptName) throw new Error("Token or script name missing");
				const headers = {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				};
				const accRes = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers });
				const accData = await accRes.json();
				if (!accData.success || accData.result.length === 0) {
					throw new Error("Account not found");
				}
				const accountId = accData.result[0].id;
				const deleteRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}`, {
					method: "DELETE",
					headers,
				});
				const deleteData = await deleteRes.json();
				if (!deleteData.success) {
					const cfError = deleteData.errors && deleteData.errors.length > 0 ? deleteData.errors[0].message : "Unknown error";
					throw new Error(cfError);
				}
				return new Response(JSON.stringify({ success: true }), {
					headers: { "Content-Type": "application/json" },
				});
			} catch (error) {
				return new Response(JSON.stringify({ success: false, error: error.message }), {
					status: 400,
					headers: { "Content-Type": "application/json" },
				});
			}
		}
		return new Response("Not Found", { status: 404 });
	},
};

function getHtmlContent() {
	return `<!DOCTYPE html>
<html lang="fa" dir="rtl" class="dark">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Royal Gateway · Deployer</title>
	<script src="https://cdn.tailwindcss.com"></script>
	<link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet" type="text/css" />
	<style>
		body { font-family: 'Vazirmatn', sans-serif; background: #0a0502; background-image: radial-gradient(circle at 30% 10%, #2b1408 0%, #0a0502 80%); min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1rem; }
		.glass-royal { background: rgba(20,10,4,0.75); backdrop-filter: blur(16px); border: 1px solid rgba(255,160,50,0.25); box-shadow: 0 20px 50px -10px rgba(255,120,0,0.3); }
		.btn-royal { background: linear-gradient(145deg, #4a1f0a, #2a1205); border: 1px solid #f59e0b; color: #fbbf24; transition: all 0.25s; }
		.btn-royal:hover { background: linear-gradient(145deg, #5f2a10, #3a1a08); border-color: #fbbf24; box-shadow: 0 0 25px rgba(245,158,11,0.3); transform: scale(1.02); }
		.input-royal { background: rgba(15,10,5,0.8); border: 1px solid #3a2a1a; color: #f5e6d3; }
		.input-royal:focus { border-color: #f59e0b; box-shadow: 0 0 0 3px rgba(245,158,11,0.15); }
		.animate-glow-pulse { animation: glowPulse 2.8s infinite alternate; }
		@keyframes glowPulse { 0% { box-shadow: 0 0 8px rgba(255,140,0,0.2); } 100% { box-shadow: 0 0 30px rgba(255,160,50,0.5); } }
		.animate-float { animation: floatY 6s ease-in-out infinite; }
		@keyframes floatY { 0%,100% { transform: translateY(0px); } 50% { transform: translateY(-6px); } }
	</style>
</head>
<body>
	<div id="mainCard" class="w-full max-w-md glass-royal rounded-3xl p-7 relative z-10 animate-glow-pulse">
		<div class="absolute -top-16 -right-16 w-56 h-56 bg-amber-700/10 rounded-full blur-3xl pointer-events-none animate-spin-slow" style="animation:spinSlow 20s linear infinite;"></div>
		<div class="text-center relative z-20">
			<div class="inline-flex items-center justify-center p-3 rounded-2xl border border-amber-600/40 bg-black/40 shadow-[0_0_30px_rgba(245,158,11,0.2)] mb-4 animate-float">
				<svg class="w-10 h-10 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"/></svg>
			</div>
			<h2 class="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-amber-400 to-orange-400">Royal Gateway</h2>
			<p class="text-sm font-medium text-amber-300/80 mt-1">نصب خودکار · پنل افسانه‌ای</p>
			<p class="text-xs font-semibold text-amber-400/60 mt-0.5">🔥 روزانه ۱۰ الی ۱۰۰ گیگ کانفیگ رایگان 🔥</p>
		</div>
		<div class="space-y-5 relative z-20 mt-4">
			<a href="https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22d1%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22workers_subdomain%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_analytics%22%2C%22type%22%3A%22read%22%7D%5D&accountId=*&zoneId=all&name=Royal-Gateway-Deployer-Token" target="_blank" class="flex items-center justify-center w-full py-3.5 border border-orange-700 text-orange-400 bg-orange-900/20 hover:bg-orange-900/40 font-bold rounded-xl text-sm transition shadow-sm hover:shadow-orange-500/20 group">
				<svg class="w-5 h-5 ml-2 group-hover:scale-110 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
				دریافت توکن کلودفلر
			</a>
			<div class="text-center text-[11px] text-amber-400/70 font-medium leading-relaxed px-1">پس از لاگین، روی دکمه <span class="font-bold text-orange-400">دریافت توکن</span> کلیک کنید و توکن را کپی کنید.</div>
			<div class="relative">
				<input type="password" id="apiToken" placeholder="توکن را وارد کنید" class="w-full pl-12 pr-4 py-3.5 input-royal rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm font-mono text-right" dir="auto">
				<button type="button" onclick="toggleToken()" class="absolute inset-y-0 left-0 flex items-center pl-4 text-amber-500/50 hover:text-amber-300 transition">
					<svg id="eyeIcon" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
				</button>
			</div>
			<button id="deployBtn" onclick="startDeploy()" class="w-full py-3.5 btn-royal font-black rounded-xl text-lg transition shadow-sm flex items-center justify-center gap-2">ساخت پنل</button>
			<button onclick="toggleUpdateModal(true)" class="w-full py-3.5 border border-amber-700 text-amber-400 bg-amber-900/20 hover:bg-amber-900/40 font-black rounded-xl text-lg transition shadow-sm flex items-center justify-center gap-2">مدیریت پنل‌ها</button>
			<div id="status-container" class="hidden mt-4 bg-black/40 rounded-xl p-4 border border-amber-800/30">
				<div class="flex justify-between items-center mb-2"><span id="status-text" class="text-xs font-bold text-amber-300">شروع...</span><span id="status-pct" class="text-xs font-black text-amber-400">۰٪</span></div>
				<div class="w-full bg-black/60 rounded-full h-1.5 overflow-hidden"><div id="progressBar" class="bg-gradient-to-r from-amber-600 to-orange-500 h-1.5 rounded-full transition-all duration-500" style="width:0%"></div></div>
			</div>
			<div id="error-box" class="hidden mt-4 p-4 bg-red-950/40 border border-red-800/40 rounded-xl text-sm text-red-300 text-center font-medium"></div>
		</div>
	</div>
	<div class="flex flex-wrap items-center justify-center gap-4 mt-6 z-10">
		<a href="https://github.com/amir52534/Royal-panel" target="_blank" class="flex items-center gap-2 px-4 py-2 border border-amber-800/40 text-amber-400 bg-black/40 hover:bg-amber-900/20 rounded-full text-sm font-bold backdrop-blur-sm transition">گیت‌هاب</a>
		<a href="https://t.me/royalpanelv2" target="_blank" class="flex items-center gap-2 px-4 py-2 border border-sky-700/40 text-sky-400 bg-black/40 hover:bg-sky-900/20 rounded-full text-sm font-bold backdrop-blur-sm transition">RoyalPanelV2</a>
		<a href="https://royal-gateway.workers.dev" target="_blank" class="flex items-center gap-2 px-4 py-2 border border-amber-700/40 text-amber-400 bg-black/40 hover:bg-amber-900/20 rounded-full text-sm font-bold backdrop-blur-sm transition">ساخت رایگان پنل</a>
		<a href="https://donatonion.ir-netlify.workers.dev" target="_blank" class="flex items-center gap-2 px-4 py-2 border border-rose-700/40 text-rose-400 bg-black/40 hover:bg-rose-900/20 rounded-full text-sm font-bold backdrop-blur-sm transition">دونیت</a>
	</div>
	<div id="toast-container" class="fixed top-5 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none"></div>
	<div id="update-modal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm opacity-0 pointer-events-none transition-opacity duration-200">
		<div id="update-modal-card" class="w-full max-w-md glass-royal rounded-3xl shadow-2xl p-5 transform transition-all scale-95 opacity-0 duration-200 flex flex-col max-h-[95vh] border border-amber-800/30">
			<div class="flex justify-between items-center mb-4"><h3 class="text-xl font-bold text-amber-200">مدیریت پنل‌ها</h3><button onclick="toggleUpdateModal(false)" class="text-amber-400/50 hover:text-amber-300">✕</button></div>
			<input type="password" id="updateApiToken" placeholder="توکن را وارد کنید" class="w-full px-4 py-3 input-royal rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm font-mono text-right mb-3">
			<button onclick="checkExistingPanels()" class="w-full py-3 border border-indigo-700/60 text-indigo-400 bg-indigo-900/20 hover:bg-indigo-900/40 font-bold rounded-xl text-md transition">بررسی پنل‌ها</button>
			<div id="panels-list-container" class="mt-4 hidden overflow-y-auto space-y-3 pr-1 pb-2"></div>
			<div id="update-status" class="hidden mt-4 text-center text-sm font-bold p-3 rounded-xl"></div>
		</div>
	</div>
	<script>
		function showToast(msg,type='success'){ const c=document.getElementById('toast-container'); const t=document.createElement('div'); t.className='px-4 py-3 border rounded-xl shadow-lg font-bold text-sm transform transition-all duration-300 -translate-y-full opacity-0 '+(type==='error'?'bg-red-950/60 border-red-700/50 text-red-300':'bg-emerald-950/60 border-emerald-700/50 text-emerald-300'); t.innerText=msg; c.appendChild(t); requestAnimationFrame(()=>t.classList.remove('-translate-y-full','opacity-0')); setTimeout(()=>{ t.classList.add('-translate-y-full','opacity-0'); setTimeout(()=>t.remove(),300); },3000); }
		function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
		function toggleToken(){ const i=document.getElementById('apiToken'); const e=document.getElementById('eyeIcon'); if(i.type==='password'){i.type='text'; e.innerHTML='<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>'; } else { i.type='password'; e.innerHTML='<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>'; } }
		function toggleUpdateModal(show){ const m=document.getElementById('update-modal'); const c=document.getElementById('update-modal-card'); if(show){ m.classList.remove('opacity-0','pointer-events-none'); m.classList.add('opacity-100','pointer-events-auto'); c.classList.remove('opacity-0','scale-95'); c.classList.add('opacity-100','scale-100'); } else { m.classList.remove('opacity-100','pointer-events-auto'); m.classList.add('opacity-0','pointer-events-none'); c.classList.remove('opacity-100','scale-100'); c.classList.add('opacity-0','scale-95'); } }
		async function startDeploy(){ const token=document.getElementById('apiToken').value.trim(); const btn=document.getElementById('deployBtn'); const sc=document.getElementById('status-container'); const st=document.getElementById('status-text'); const sp=document.getElementById('status-pct'); const pb=document.getElementById('progressBar'); const eb=document.getElementById('error-box'); if(!token){ eb.classList.remove('hidden'); eb.innerText='لطفاً توکن را وارد کنید.'; return; } eb.classList.add('hidden'); btn.disabled=true; btn.innerText='در حال پردازش...'; sc.classList.remove('hidden'); st.innerText='در حال بررسی توکن...'; sp.innerText='۱۵٪'; pb.style.width='15%'; await sleep(500); st.innerText='در حال ارتباط با کلودفلر...'; sp.innerText='۳۰٪'; pb.style.width='30%'; await sleep(500); st.innerText='در حال ایجاد دیتابیس...'; sp.innerText='۵۰٪'; pb.style.width='50%'; try{ const res=await fetch('/api/deploy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}); st.innerText='در حال دریافت پنل...'; sp.innerText='۷۵٪'; pb.style.width='75%'; await sleep(600); st.innerText='در حال فعال‌سازی...'; sp.innerText='۹۰٪'; pb.style.width='90%'; await sleep(500); const data=await res.json(); if(data.success){ pb.style.width='100%'; sp.innerText='۱۰۰٪'; st.innerText='تکمیل!'; await sleep(400); sc.classList.add('hidden'); const d=document.createElement('div'); d.className='text-center mt-4 font-bold text-emerald-400'; d.innerText='✅ پنل ساخته شد!'; document.getElementById('mainCard').appendChild(d); const l=document.createElement('div'); l.className='mt-3 p-3 bg-black/40 rounded-xl border border-emerald-700/40 text-center'; l.innerHTML='<span class="text-xs text-emerald-300 break-all">'+data.url+'</span><button onclick="navigator.clipboard.writeText(\''+data.url+'\')" class="block w-full mt-2 py-1.5 border border-emerald-700 text-emerald-400 bg-emerald-900/20 hover:bg-emerald-900/40 rounded-lg text-xs font-bold transition">کپی لینک</button>'; document.getElementById('mainCard').appendChild(l); } else throw new Error(data.error); } catch(e){ sc.classList.add('hidden'); eb.classList.remove('hidden'); eb.innerText=e.message; btn.disabled=false; btn.innerText='ساخت پنل'; } }
		async function checkExistingPanels(){ const token=document.getElementById('updateApiToken').value.trim(); const btn=document.getElementById('checkPanelsBtn'); const list=document.getElementById('panels-list-container'); const status=document.getElementById('update-status'); if(!token){ status.classList.remove('hidden'); status.className='mt-4 text-center text-sm font-bold p-3 rounded-xl bg-red-950/40 border border-red-800/40 text-red-300'; status.innerText='توکن وارد نشده'; return; } btn.disabled=true; btn.innerText='در حال بررسی...'; status.classList.add('hidden'); list.classList.add('hidden'); list.innerHTML=''; try{ const res=await fetch('/api/list-panels',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}); const data=await res.json(); if(data.success){ if(data.panels.length===0){ status.classList.remove('hidden'); status.className='mt-4 text-center text-sm font-bold p-3 rounded-xl bg-yellow-950/40 border border-yellow-800/40 text-yellow-300'; status.innerText='هیچ پنلی یافت نشد'; } else { data.panels.forEach(p=>{ const div=document.createElement('div'); div.className='flex flex-col gap-2 p-3 bg-black/40 border border-amber-800/30 rounded-xl'; div.innerHTML='<span class="font-bold text-amber-200 break-all">'+p.name+'</span><div class="flex gap-2 flex-wrap"><button onclick="updatePanel(\''+p.name+'\')" class="px-3 py-1 border border-purple-700 text-purple-400 bg-purple-900/20 hover:bg-purple-900/40 rounded-lg text-xs font-bold transition">آپدیت</button><button onclick="deletePanel(\''+p.name+'\')" class="px-3 py-1 border border-red-700 text-red-400 bg-red-900/20 hover:bg-red-900/40 rounded-lg text-xs font-bold transition">حذف</button><button onclick="resetPanelPassword(\''+p.name+'\')" class="px-3 py-1 border border-yellow-700 text-yellow-400 bg-yellow-900/20 hover:bg-yellow-900/40 rounded-lg text-xs font-bold transition">بازیابی رمز</button></div></div>'; list.appendChild(div); }); list.classList.remove('hidden'); } } else throw new Error(data.error); } catch(e){ status.classList.remove('hidden'); status.className='mt-4 text-center text-sm font-bold p-3 rounded-xl bg-red-950/40 border border-red-800/40 text-red-300'; status.innerText='خطا: '+e.message; } finally { btn.disabled=false; btn.innerText='بررسی پنل‌ها'; } }
		async function updatePanel(name){ const token=document.getElementById('updateApiToken').value.trim(); if(!confirm('آپدیت '+name+'؟')) return; showToast('در حال آپدیت...'); try{ const res=await fetch('/api/do-update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token, scriptName:name})}); const data=await res.json(); if(data.success){ showToast('✅ آپدیت شد'); setTimeout(checkExistingPanels,2000); } else throw new Error(data.error); } catch(e){ showToast('خطا: '+e.message,'error'); } }
		async function deletePanel(name){ const token=document.getElementById('updateApiToken').value.trim(); if(!confirm('حذف '+name+'؟')) return; showToast('در حال حذف...'); try{ const res=await fetch('/api/delete-panel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token, scriptName:name})}); const data=await res.json(); if(data.success){ showToast('✅ حذف شد'); setTimeout(checkExistingPanels,2000); } else throw new Error(data.error); } catch(e){ showToast('خطا: '+e.message,'error'); } }
		async function resetPanelPassword(name){ const token=document.getElementById('updateApiToken').value.trim(); if(!confirm('بازیابی رمز عبور '+name+'؟')) return; showToast('در حال بازیابی رمز...'); try{ const res=await fetch('/api/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token, scriptName:name})}); const data=await res.json(); if(data.success){ showToast('✅ رمز عبور بازنشانی شد'); setTimeout(checkExistingPanels,2000); } else throw new Error(data.error); } catch(e){ showToast('خطا: '+e.message,'error'); } }
		window.startDeploy=startDeploy; window.toggleToken=toggleToken; window.toggleUpdateModal=toggleUpdateModal; window.checkExistingPanels=checkExistingPanels; window.updatePanel=updatePanel; window.deletePanel=deletePanel; window.resetPanelPassword=resetPanelPassword;
	</script>
</body>
</html>`;
}
