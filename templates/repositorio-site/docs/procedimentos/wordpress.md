# Atualizações WordPress

Problemas: `wp_core_outdated`, `wp_updates_pending`, `wp_known_vulnerability`.

As versões vêm da WP Umbrella, na evidência da issue. O Jellycare já aplica
atualizações sozinho dentro da janela de manutenção, quando a opção está ligada
no site; se estiver desligada, considera propor ligá-la em vez de um plano
manual.

## O plano

1. **Cópia de segurança antes**, pela WP Umbrella, e confirmar que terminou.
2. **Ordem:** plugins sem dependências primeiro, depois os críticos do
   `site.yml` (`wordpress.plugins_criticos`), **um de cada vez**, com
   verificação entre cada um. O core no fim, salvo se a vulnerabilidade for
   no core.
3. **Compatibilidade:** confirma no changelog de cada plugin crítico a versão
   mínima de PHP e de WordPress, e se a atualização é *major*. Uma *major* de
   WooCommerce, WPML ou de um construtor de páginas vai primeiro ao `staging`,
   se houver; se não houver, diz isso no risco.
4. **`wp_known_vulnerability`:** cita o aviso (CVE ou boletim) e a versão que o
   corrige. Se a correção não existir, propõe a mitigação: desativar o plugin,
   ou uma regra de firewall, e o que o cliente perde com isso.
5. **Dentro da janela** de manutenção do `site.yml`.

## Como se entrega

Em `config/wordpress/plano.md`: tabela com componente, versão atual, versão
nova, ordem, risco e como se nota que partiu (a página a abrir, o formulário a
testar, a compra de teste). Com acesso `ssh`, os comandos WP-CLI
(`wp plugin update <nome>`); com `painel`, os cliques na WP Umbrella ou no
backoffice.

## Confirmar

Na WP Umbrella, as versões; no site, a homepage e as páginas do `site.yml`
sem erros. O Jellycare volta a ler o inventário e fecha o problema.
