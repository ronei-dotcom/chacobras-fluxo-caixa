# Chacobras — Fluxo de Caixa

Aplicativo estático para GitHub Pages. Abra LEIA_PRIMEIRO.html para configurar Firebase, acesso Google e importar o arquivo privado com os dados iniciais.

Publique index.html e os arquivos acompanhantes na raiz da branch main. Não é necessário instalar pacotes.

Os dados financeiros ficam no Firestore ou no JSON privado, nunca neste repositório. O código preserva a estrutura bancária do modelo 2026–2035.

## Configuração necessária

1. Google ativado no Firebase Authentication.
2. Domínio ronei-dotcom.github.io autorizado no Authentication.
3. Regras do arquivo firestore.rules publicadas no banco (default).
4. Primeiro acesso e importação pelo administrador.

O arquivo firebase-config.js é configuração pública de cliente, não uma chave privada de conta de serviço. A autorização é feita pelas regras do Firestore.

## Validação

700 valores do bloco Calculos comparados com o Excel oficial: diferença máxima inferior a USD 0,01. Nove testes automatizados passaram, incluindo dívidas, terra, projeção de taxas, validação de entradas e 200 cenários de conciliação. A conexão autenticada e as regras no projeto Firebase precisam de validação após a implantação.
