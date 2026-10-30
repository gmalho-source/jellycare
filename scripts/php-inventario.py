#!/usr/bin/env python3
"""
Inventário de PHP do servidor cPanel/CloudLinux, antes de mudar versões.

Corre como root no Terminal do WHM (Server Configuration → Terminal), que é o
que temos em vez de SSH. Só lê: não altera versões, ficheiros nem configuração.
Não usa nada fora da biblioteca padrão e aguenta o python3 antigo do
CloudLinux 7 (3.6).

Para cada vhost escreve uma linha com a conta, a versão que está de facto a
correr, a versão do MultiPHP, se é a do sistema (só aí manda o PHP Selector do
CloudLinux), a versão que o Selector tem para a conta, a stack detetada pelos ficheiros, se há código
encriptado com ionCube e o tamanho do error_log.

    python3 php-inventario.py              # CSV em /root/php-inventario-AAAAMMDD.csv
    python3 php-inventario.py --stdout     # o CSV no ecrã, para copiar
"""
import csv
import datetime
import json
import os
import re
import subprocess
import sys

MAX_PHP_FILES = 3000  # por site; chega para detetar ionCube sem varrer tudo
IONCUBE_MARKS = (b"ionCube Loader", b"sg_load(", b"<?php //00")


def run(cmd):
    try:
        out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, timeout=60)
        return out.decode("utf-8", "replace")
    except Exception:
        return ""


def whmapi(fn):
    raw = run(["whmapi1", fn, "--output=json"])
    try:
        return json.loads(raw).get("data") or {}
    except ValueError:
        sys.exit("whmapi1 %s falhou: isto tem de correr como root no servidor." % fn)


def selector_version(user, cache={}):
    """Versão do CloudLinux PHP Selector para a conta ('native' = sem Selector)."""
    if user not in cache:
        out = run(["selectorctl", "--interpreter=php", "--user-current", "--user=" + user])
        cache[user] = out.split()[0] if out.strip() else ""
    return cache[user]


def read(path, limit=4096):
    try:
        with open(path, "rb") as f:
            return f.read(limit)
    except OSError:
        return b""


def detect_stack(doc):
    j = lambda *p: os.path.join(doc, *p)
    ex = os.path.exists
    if ex(j("wp-includes", "version.php")):
        m = re.search(rb"\$wp_version\s*=\s*'([^']+)'", read(j("wp-includes", "version.php"), 8192))
        return "WordPress " + (m.group(1).decode() if m else "?")
    if ex(j("wp-config.php")):
        return "WordPress ?"
    if ex(j("artisan")):
        return "Laravel"
    if ex(j("configuration.php")) and ex(j("administrator")):
        return "Joomla"
    if ex(j("config", "settings.inc.php")) or ex(j("app", "config", "parameters.php")):
        return "PrestaShop"
    if ex(j("core", "lib", "Drupal.php")) or ex(j("includes", "bootstrap.inc")):
        return "Drupal"
    if ex(j("index.php")):
        return "PHP (outro)"
    return ""


def scan_php(doc):
    """Conta ficheiros .php (até ao limite) e procura código ionCube."""
    count, ioncube = 0, False
    for root, dirs, files in os.walk(doc):
        dirs[:] = [d for d in dirs if d not in ("node_modules", ".git", "cache")]
        for name in files:
            if not name.endswith(".php"):
                continue
            count += 1
            if not ioncube and any(m in read(os.path.join(root, name), 2048) for m in IONCUBE_MARKS):
                ioncube = True
            if count >= MAX_PHP_FILES:
                return count, ioncube
    return count, ioncube


def main():
    default = whmapi("php_get_system_default_version").get("version", "")
    vhosts = whmapi("php_get_vhost_versions").get("versions", [])
    has_selector = bool(run(["which", "selectorctl"]).strip())

    rows = []
    for v in sorted(vhosts, key=lambda v: (v.get("account", ""), v.get("vhost", ""))):
        doc = v.get("documentroot", "")
        version = v.get("version", "")
        user = v.get("account", "")
        stack = detect_stack(doc)
        php_files, ioncube = scan_php(doc)
        if not stack:
            stack = "Estático (sem PHP)" if php_files == 0 else "PHP (outro)"
        try:
            err = os.path.getsize(os.path.join(doc, "error_log"))
        except OSError:
            err = 0
        selector = selector_version(user) if has_selector else ""
        # O Selector só manda quando o domínio está na versão do sistema.
        if version == default and selector and selector != "native":
            efetivo = "alt-php" + selector.replace(".", "")
        else:
            efetivo = version
        rows.append({
            "conta": user,
            "dominio": v.get("vhost", ""),
            "php_efetivo": efetivo,
            "multiphp": version,
            "e_default": "sim" if version == default else "não",
            "selector_conta": selector,
            "php_fpm": "sim" if v.get("php_fpm") else "não",
            "stack": stack,
            "ficheiros_php": php_files if php_files < MAX_PHP_FILES else "%d+" % MAX_PHP_FILES,
            "ioncube": "sim" if ioncube else "",
            "error_log_kb": err // 1024,
            "suspenso": "sim" if v.get("is_suspended") else "",
            "docroot": doc,
        })

    fields = list(rows[0].keys()) if rows else ["conta"]
    if "--stdout" in sys.argv:
        out, path = sys.stdout, None
    else:
        path = "/root/php-inventario-%s.csv" % datetime.date.today().strftime("%Y%m%d")
        out = open(path, "w", newline="", encoding="utf-8")
    w = csv.DictWriter(out, fieldnames=fields)
    w.writeheader()
    w.writerows(rows)
    if path:
        out.close()

    summary = {}
    for r in rows:
        k = (r["php_efetivo"], r["stack"].split(" ")[0])
        summary[k] = summary.get(k, 0) + 1
    log = sys.stderr
    print("\nPHP do sistema: %s · vhosts: %d" % (default, len(rows)), file=log)
    for (ver, stack), n in sorted(summary.items()):
        print("  %-10s %-12s %3d" % (ver, stack, n), file=log)
    if path:
        print("\nCSV em %s" % path, file=log)


if __name__ == "__main__":
    main()
