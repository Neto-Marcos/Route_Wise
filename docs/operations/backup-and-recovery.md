# Backup e recuperação

Backup diário às 03:00 UTC (00:00 em São Paulo), serviço Railway `criar-rota-backup`, banco PostgreSQL 18. Retenção de 30 dias no bucket privado `criar-rota-backups`; não requer upgrade de plano. Há consumo normal de computação e armazenamento.

O job usa snapshot consistente somente leitura. Transmite pg_dump para criptografia AES-256-GCM, envia o objeto ao bucket, baixa novamente, verifica SHA-256 e restaura em PostgreSQL efêmero limitado a loopback. Compara quantidade de registros de todas as tabelas e bytes dos arquivos em upload_objects. Só então atualiza latest.json e remove backups próprios vencidos. Cada objeto tem manifesto JSON de verificação.

Primeiro exercício real: 19/10/2026 22:49 UTC, 25 tabelas, 15.848.225 bytes de backup criptografado e 6.095.597 bytes de comprovantes; restauração aprovada. O banco original não foi restaurado nem alterado pelo exercício.

## Credenciais e chave

Variáveis do serviço usam referências Railway para banco e bucket. BACKUP_ENCRYPTION_KEY existe apenas no serviço de backup e na cópia administrativa local `.tools/operations-secrets.json`, ignorada pelo Git. Nunca publicar esse arquivo. A chave é indispensável para recuperação: manter cópia em cofre de senhas administrado pelo proprietário; a cópia local não substitui um cofre independente. O monitor não recebe chave de descriptografia nem acesso ao banco.

## Recuperação operacional

1. Interromper gravações apenas quando houver decisão de troca do banco; preservar o original.
2. Provisionar PostgreSQL 18 vazio, separado da produção. Confirmar nome/host e ausência de tabelas.
3. Escolher objeto `.pgdump.enc` e seu manifesto no bucket, verificar SHA-256 e decryptBackup de ops/jobs/crypto-backup.mjs usando a chave administrativa em ambiente protegido.
4. Executar pg_restore --exit-on-error --no-owner --no-acl no banco NOVO. Não usar --clean em produção.
5. Comparar contagens do manifesto e soma de octet_length(file_data); conferir login, rotas, comprovantes e planilha em ambiente isolado.
6. Somente depois da validação trocar DATABASE_URL do aplicativo e fazer deploy. Guardar o banco anterior para reversão.

A restauração automática diária exercita o arquivo remoto; a troca de banco real exige conferência administrativa. Não há garantia de recuperação de dados criados depois do último backup. Meta inicial de perda máxima: 24 horas enquanto o job diário estiver saudável; tempo de recuperação operacional ainda não medido.
