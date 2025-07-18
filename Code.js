// =================================================================
// ARQUIVO PRINCIPAL DO SERVIDOR - Code.gs (VERSÃO COM CORREÇÃO DE SALVAMENTO)
// =================================================================

const NOME_ABA_USUARIOS = "Usuarios";
const NOME_ABA_DADOS = "DADOS";
const NOME_ABA_MODELO = "MODELO";

/**
 * VERIFICA A AUTENTICAÇÃO E OBTÉM O STATUS DE VENCIMENTO GLOBAL DO CLIENTE.
 */
function verificarAutenticacaoEObterInfo(token) {
  if (!token) return { autenticado: false };

  const email = CacheService.getScriptCache().get(token);
  if (!email) return { autenticado: false };

  try {
    const abaUsuarios = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Usuarios");
    const emailsNaPlanilha = abaUsuarios.getRange(2, 1, abaUsuarios.getLastRow() - 1, 1).getValues().flat();
    const usuarioValido = emailsNaPlanilha.some(e => String(e).toLowerCase() === email);

    if (!usuarioValido) {
      Logger.log(`Tentativa de login falhou: o email ${email} não foi encontrado na lista de usuários.`);
      return { autenticado: false };
    }
    const statusVencimento = abaUsuarios.getRange("G2").getValue();
    return { autenticado: true, statusVencimento: statusVencimento };

  } catch (e) {
    Logger.log("Erro ao buscar status de vencimento: " + e.message);
    return { autenticado: true, statusVencimento: null };
  }
}

// =================================================================
// ROTEAMENTO E SERVIÇO DE PÁGINAS HTML
// =================================================================
function doGet(e) {
  const page = e.parameter.page || 'BoasVindas';
  const authToken = e.parameter.authToken;
  const paginasPublicas = ['login', 'register', 'forgot', 'reset'];

  const authInfo = verificarAutenticacaoEObterInfo(authToken);

  if (!paginasPublicas.includes(page) && !authInfo.autenticado) {
    return HtmlService.createTemplateFromFile('Login.html')
      .evaluate()
      .setTitle("Sistemas ARK")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  let template;
  switch(page) {
    case 'BoasVindas': template = HtmlService.createTemplateFromFile('BoasVindas.html'); break;
    case 'index': template = HtmlService.createTemplateFromFile('Index.html'); break;
    case 'lancamentos': template = HtmlService.createTemplateFromFile('Lancamentos.html'); break;
    case 'cadastro': template = HtmlService.createTemplateFromFile('Cadastro.html'); break;
    case 'login': template = HtmlService.createTemplateFromFile('Login.html'); break;
    case 'register': template = HtmlService.createTemplateFromFile('Register.html'); break;
    case 'forgot': template = HtmlService.createTemplateFromFile('ForgotPassword.html'); break;
    case 'reset':
      template = HtmlService.createTemplateFromFile('ResetPassword.html');
      template.token = e.parameter.token || '';
      break;
    default: template = HtmlService.createTemplateFromFile('BoasVindas.html'); break;
  }

  if (authInfo.autenticado) {
    template.authToken = authToken;
    template.statusVencimento = authInfo.statusVencimento;
  }

  return template.evaluate()
    .setTitle("Sistemas ARK")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getScriptUrl() {
  return ScriptApp.getService().getUrl();
}

function isTokenValido(token) {
  if (!token) return false;
  const user = CacheService.getScriptCache().get(token);
  return user != null;
}

const cache = CacheService.getScriptCache();
function getFromCache(key) { const cached = cache.get(key); if (cached != null) { return JSON.parse(cached); } return null; }
function putInCache(key, value, expiration = 600) { cache.put(key, JSON.stringify(value), expiration); }


function registrarUsuario(email, senhaHash, token) {
  try {
    const abaUsuarios = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOME_ABA_USUARIOS);
    const dados = abaUsuarios.getDataRange().getValues();
    for (let i = 1; i < dados.length; i++) {
      if (dados[i][0].toLowerCase() === email) {
        return { success: false, error: "Este email já pertence a um usuário." };
      }
    }
    for (let i = 1; i < dados.length; i++) {
      if (dados[i][4] === token) {
        if (dados[i][5] === 'Ativo') {
          return { success: false, error: "Este token de autorização já foi utilizado." };
        }
        const linhaParaAtualizar = i + 1;
        abaUsuarios.getRange(linhaParaAtualizar, 1).setValue(email);
        abaUsuarios.getRange(linhaParaAtualizar, 2).setValue(senhaHash);
        abaUsuarios.getRange(linhaParaAtualizar, 6).setValue('Ativo');
        return { success: true };
      }
    }
    return { success: false, error: "Token de autorização inválido." };
  } catch(e) {
    Logger.log(e);
    return { success: false, error: "Ocorreu um erro no servidor ao registrar." };
  }
}

function verificarLogin(email, senhaHash) {
  try {
    const abaUsuarios = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOME_ABA_USUARIOS);
    const dados = abaUsuarios.getDataRange().getValues();
    for (let i = 1; i < dados.length; i++) {
      if (String(dados[i][0]).toLowerCase() === email) {
        if (dados[i][1] === senhaHash) {
          const token = Utilities.getUuid();
          CacheService.getScriptCache().put(token, email, 7200);
          return { success: true, token: token };
        } else {
          return { success: false, error: "Email ou Senha incorreta." };
        }
      }
    }
    return { success: false, error: "Usuário não encontrado." };
  } catch (e) {
    Logger.log(e);
    return { success: false, error: "Erro ao verificar o login." };
  }
}

function iniciarResetSenha(email) {
  try {
    const abaUsuarios = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOME_ABA_USUARIOS);
    const dados = abaUsuarios.getRange(1, 1, abaUsuarios.getLastRow(), 1).getValues();
    const emails = dados.flat().map(e => String(e).toLowerCase());
    const rowIndex = emails.indexOf(email);
    if (rowIndex === -1) {
      return { success: true };
    }
    const token = Utilities.getUuid();
    const expiration = new Date(new Date().getTime() + 60 * 60 * 1000);
    abaUsuarios.getRange(rowIndex + 1, 3).setValue(token);
    abaUsuarios.getRange(rowIndex + 1, 4).setValue(expiration);
    const resetUrl = `${getScriptUrl()}?page=reset&token=${token}`;
    const subject = "Redefinição de Senha - Sistemas ARK";
    const body = `Olá,\n\nVocê solicitou a redefinição de sua senha. Clique no link abaixo para criar uma nova senha. Este link é válido por 1 hora.\n\n${resetUrl}\n\nSe você não solicitou isso, pode ignorar este e-mail.\n\nAtenciosamente,\nEquipe Sistemas ARK`;
    MailApp.sendEmail(email, subject, body);
    return { success: true };
  } catch (e) {
    Logger.log(e);
    return { success: true };
  }
}

function verificarToken(token) {
  try {
    if (!token) return { success: false };
    const abaUsuarios = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOME_ABA_USUARIOS);
    const dados = abaUsuarios.getRange(1, 3, abaUsuarios.getLastRow(), 2).getValues();
    for (let i = 0; i < dados.length; i++) {
      if (dados[i][0] === token) {
        const expirationDate = new Date(dados[i][1]);
        if (expirationDate > new Date()) {
          return { success: true };
        }
      }
    }
    return { success: false };
  } catch (e) { Logger.log(e); return { success: false }; }
}

function redefinirSenha(token, novaSenhaHash) {
  try {
    if (!token) return { success: false, error: "Token inválido." };
    const abaUsuarios = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOME_ABA_USUARIOS);
    const dados = abaUsuarios.getRange(1, 3, abaUsuarios.getLastRow(), 2).getValues();
    for (let i = 0; i < dados.length; i++) {
      if (dados[i][0] === token) {
        const expirationDate = new Date(dados[i][1]);
        if (expirationDate > new Date()) {
          const userRow = i + 1;
          abaUsuarios.getRange(userRow, 2).setValue(novaSenhaHash);
          abaUsuarios.getRange(userRow, 3, 1, 2).clearContent();
          return { success: true };
        }
      }
    }
    return { success: false, error: "Link de redefinição inválido ou expirado." };
  } catch (e) { Logger.log(e); return { success: false, error: "Ocorreu um erro ao redefinir a senha." }; }
}

function getFuncionarios(authToken) {
  if (!isTokenValido(authToken)) return { erro: "Acesso não autorizado." };
  const cacheKey = 'lista_funcionarios';
  const cachedData = getFromCache(cacheKey);
  if (cachedData) return cachedData;
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  const todasAsAbas = planilha.getSheets();
  const funcionarios = [];
  const abasParaIgnorar = [NOME_ABA_MODELO, NOME_ABA_DADOS, NOME_ABA_USUARIOS];
  todasAsAbas.forEach(aba => {
    const nomeAba = aba.getName();
    if (!abasParaIgnorar.map(n => n.toUpperCase()).includes(nomeAba.toUpperCase())) {
      funcionarios.push(nomeAba);
    }
  });
  const sortedFuncionarios = funcionarios.sort();
  putInCache(cacheKey, sortedFuncionarios);
  return sortedFuncionarios;
}

function getDadosFuncionario(authToken, nomeFuncionario) {
  if (!isTokenValido(authToken)) return { sucesso: false, erro: "Acesso não autorizado." };
  const cacheKey = `dados_func_${nomeFuncionario}`;
  const cachedData = getFromCache(cacheKey);
  if (cachedData) return cachedData;
  try {
    const planilha = SpreadsheetApp.getActiveSpreadsheet();
    const aba = planilha.getSheetByName(nomeFuncionario);
    if (!aba) throw new Error("Funcionário não encontrado");
    if (aba.getLastRow() < 2) return { sucesso: true, vendas: [], gastos: [] };
    const data = aba.getRange(2, 1, aba.getLastRow() - 1, aba.getLastColumn()).getValues();
    const vendas = [];
    const gastos = [];
    data.forEach((linha, index) => {
      if (linha[0] && linha[0] instanceof Date) {
        vendas.push({ id: `venda_${index}`, data: linha[0].toISOString(), quantidade: linha[1], produto: linha[2], comprador: linha[3], valor: linha[4], valorTotal: linha[5], status: linha[6] });
      }
      if (linha[8] && linha[8] instanceof Date) {
        gastos.push({ id: `gasto_${index}`, data: linha[8].toISOString(), quantidade: linha[9], compra: linha[10], valor: linha[11], valorTotal: linha[12], status: linha[13], fornecedor: linha[14] });
      }
    });
    const resultado = { sucesso: true, vendas, gastos };
    putInCache(cacheKey, resultado, 300);
    return resultado;
  } catch (e) {
    return { sucesso: false, erro: e.message };
  }
}

// ESTA É A FUNÇÃO CORRIGIDA
function salvarLancamentos(authToken, nomeFuncionario, dados) {
  if (!isTokenValido(authToken)) return { sucesso: false, erro: "Acesso não autorizado." };
  try {
    const planilha = SpreadsheetApp.getActiveSpreadsheet();
    const aba = planilha.getSheetByName(nomeFuncionario);
    if (!aba) throw new Error("Funcionário não encontrado");
    if (aba.getLastRow() > 1) {
      aba.getRange(2, 1, aba.getLastRow() - 1, aba.getLastColumn()).clearContent();
    }
    const vendas = dados.vendas || [];
    const gastos = dados.gastos || [];
    const maxLinhas = Math.max(vendas.length, gastos.length);
    if (maxLinhas === 0) {
        cache.remove(`dados_func_${nomeFuncionario}`);
        cache.remove('dados_iniciais_dashboard');
        return { sucesso: true };
    }
    const dadosParaSalvar = [];
    for (let i = 0; i < maxLinhas; i++) {
      const linha = new Array(15).fill(null);
      if (vendas[i]) {
        linha[0] = new Date(vendas[i].data);
        linha[1] = vendas[i].quantidade || null;
        linha[2] = vendas[i].produto || null;
        linha[3] = vendas[i].comprador || null;
        linha[4] = vendas[i].valor || null;
        linha[5] = vendas[i].valorTotal || null;
        linha[6] = vendas[i].status || null;
      }
      if (gastos[i]) {
        linha[8] = new Date(gastos[i].data);
        linha[9] = gastos[i].quantidade || null;
        linha[10] = gastos[i].compra || null; // CORRIGIDO DE 'insumo' PARA 'compra'
        linha[11] = gastos[i].valor || null;
        linha[12] = gastos[i].valorTotal || null;
        linha[13] = gastos[i].status || null;
        linha[14] = gastos[i].fornecedor || null;
      }
      dadosParaSalvar.push(linha);
    }
    if (dadosParaSalvar.length > 0) {
      aba.getRange(2, 1, dadosParaSalvar.length, 15).setValues(dadosParaSalvar);
    }
    cache.remove(`dados_func_${nomeFuncionario}`);
    cache.remove('dados_iniciais_dashboard');
    return { sucesso: true };
  } catch(e) {
    return { sucesso: false, erro: e.message };
  }
}

const COLUNAS_CADASTRO = { 'produto': 1, 'comprador': 2, 'compra': 3, 'fornecedor': 4 };

function getDadosCadastro(authToken) {
  if (!isTokenValido(authToken)) return { erro: "Acesso não autorizado." };
  const cacheKey = 'dados_cadastro';
  const cachedData = getFromCache(cacheKey);
  if (cachedData) return cachedData;
  try {
    const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOME_ABA_DADOS);
    if (!aba) throw new Error(`A aba "${NOME_ABA_DADOS}" não foi encontrada.`);
    const lastRow = aba.getLastRow();
    const dados = {
      produtos: lastRow > 1 ? aba.getRange(2, COLUNAS_CADASTRO.produto, lastRow - 1).getValues().flat().filter(String) : [],
      compradores: lastRow > 1 ? aba.getRange(2, COLUNAS_CADASTRO.comprador, lastRow - 1).getValues().flat().filter(String) : [],
      compras: lastRow > 1 ? aba.getRange(2, COLUNAS_CADASTRO.compra, lastRow - 1).getValues().flat().filter(String) : [],
      fornecedores: lastRow > 1 ? aba.getRange(2, COLUNAS_CADASTRO.fornecedor, lastRow - 1).getValues().flat().filter(String) : []
    };
    putInCache(cacheKey, dados);
    return dados;
  } catch (e) {
    return { erro: e.message };
  }
}

function adicionarItem(authToken, tipo, valor) {
  if (!isTokenValido(authToken)) return { sucesso: false, erro: "Acesso não autorizado." };
  try {
    if (!valor || !tipo) throw new Error("Dados inválidos para adicionar.");
    const coluna = COLUNAS_CADASTRO[tipo];
    if (!coluna) throw new Error("Tipo de cadastro inválido.");
    const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOME_ABA_DADOS);
    const todosOsValoresDaColuna = aba.getRange(1, coluna, aba.getMaxRows()).getValues();
    const ultimaLinhaComConteudo = todosOsValoresDaColuna.filter(String).length;
    const proximaLinhaVazia = ultimaLinhaComConteudo + 1;
    aba.getRange(proximaLinhaVazia, coluna).setValue(valor);
    cache.remove('dados_cadastro');
    cache.remove('dados_iniciais_dashboard');
    return { sucesso: true };
  } catch (e) {
    return { sucesso: false, erro: e.message };
  }
}

function editarItem(authToken, tipo, valorAntigo, valorNovo) {
  if (!isTokenValido(authToken)) return { sucesso: false, erro: "Acesso não autorizado." };
  try {
    if (!valorAntigo || !valorNovo || !tipo) throw new Error("Dados inválidos para editar.");
    const coluna = COLUNAS_CADASTRO[tipo];
    if (!coluna) throw new Error("Tipo de cadastro inválido.");
    const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOME_ABA_DADOS);
    const textFinder = aba.getRange(1, coluna, aba.getLastRow()).createTextFinder(valorAntigo).matchEntireCell(true);
    const celulaEncontrada = textFinder.findNext();
    if (celulaEncontrada) {
      celulaEncontrada.setValue(valorNovo);
      cache.remove('dados_cadastro');
      cache.remove('dados_iniciais_dashboard');
      return { sucesso: true };
    } else {
      throw new Error(`Item "${valorAntigo}" não encontrado para editar.`);
    }
  } catch (e) {
    return { sucesso: false, erro: e.message };
  }
}

function excluirItem(authToken, tipo, valor) {
  if (!isTokenValido(authToken)) return { sucesso: false, erro: "Acesso não autorizado." };
  try {
    if (!valor || !tipo) throw new Error("Dados inválidos para excluir.");
    const coluna = COLUNAS_CADASTRO[tipo];
    if (!coluna) throw new Error("Tipo de cadastro inválido.");
    const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOME_ABA_DADOS);
    const textFinder = aba.getRange(1, coluna, aba.getLastRow()).createTextFinder(valor).matchEntireCell(true);
    const celulaEncontrada = textFinder.findNext();
    if (celulaEncontrada) {
      aba.deleteRow(celulaEncontrada.getRow());
      cache.remove('dados_cadastro');
      cache.remove('dados_iniciais_dashboard');
      return { sucesso: true };
    } else {
      throw new Error(`Item "${valor}" não encontrado para excluir.`);
    }
  } catch (e) {
    return { sucesso: false, erro: e.message };
  }
}

function adicionarFuncionario(authToken, nome) {
  if (!isTokenValido(authToken)) return { sucesso: false, erro: "Acesso não autorizado." };
  try {
    const planilha = SpreadsheetApp.getActiveSpreadsheet();
    const nomeNormalizado = nome.trim();
    if (!nomeNormalizado) return { sucesso: false, erro: 'O nome do funcionário não pode estar vazio.' };
    if (planilha.getSheetByName(nomeNormalizado)) return { sucesso: false, erro: 'Já existe um funcionário com esse nome.' };
    const modeloSheet = planilha.getSheetByName(NOME_ABA_MODELO);
    if (!modeloSheet) return { sucesso: false, erro: `A aba "${NOME_ABA_MODELO}" não foi encontrada.` };
    const novaAba = modeloSheet.copyTo(planilha);
    novaAba.setName(nomeNormalizado);
    cache.remove('lista_funcionarios');
    cache.remove('dados_iniciais_dashboard');
    return { sucesso: true, mensagem: `Funcionário "${nomeNormalizado}" criado com sucesso!` };
  } catch (e) {
    Logger.log(e);
    return { sucesso: false, erro: 'Ocorreu um erro inesperado: ' + e.toString() };
  }
}

function deletarFuncionario(authToken, nomeFuncionario) {
  if (!isTokenValido(authToken)) return { sucesso: false, erro: "Acesso não autorizado." };
  try {
    const planilha = SpreadsheetApp.getActiveSpreadsheet();
    const abaParaDeletar = planilha.getSheetByName(nomeFuncionario);
    if (abaParaDeletar) {
      if([NOME_ABA_MODELO, NOME_ABA_DADOS, NOME_ABA_USUARIOS].includes(nomeFuncionario.toUpperCase())){
        return { sucesso: false, erro: "Esta aba de sistema não pode ser deletada." };
      }
      planilha.deleteSheet(abaParaDeletar);
      cache.remove('lista_funcionarios');
      cache.remove(`dados_func_${nomeFuncionario}`);
      cache.remove('dados_iniciais_dashboard');
      return { sucesso: true, mensagem: `Funcionário "${nomeFuncionario}" deletado com sucesso.` };
    } else {
      throw new Error("Funcionário não encontrado.");
    }
  } catch (e) {
    return { sucesso: false, erro: e.message };
  }
}

function getDadosIniciais(authToken) {
  if (!isTokenValido(authToken)) return { erro: "Acesso não autorizado." };
  const cacheKey = 'dados_iniciais_dashboard';
  const cachedData = getFromCache(cacheKey);
  if (cachedData) return cachedData;
  const planilha = SpreadsheetApp.getActiveSpreadsheet();
  const todasAsAbas = planilha.getSheets();
  const transacoes = [];
  const funcionariosSet = new Set();
  const dadosCadastrados = getDadosCadastro(authToken);
  const produtosSet = new Set(dadosCadastrados.produtos || []);
  const comprasSet = new Set(dadosCadastrados.compras || []);
  const compradoresSet = new Set(dadosCadastrados.compradores || []);
  const fornecedoresSet = new Set(dadosCadastrados.fornecedores || []);
  const statusSet = new Set();
  const abasParaIgnorar = [NOME_ABA_MODELO, NOME_ABA_DADOS, NOME_ABA_USUARIOS];
  for (const aba of todasAsAbas) {
    const nomeDaAba = aba.getName().trim(); 
    if (abasParaIgnorar.map(n => n.toUpperCase()).includes(nomeDaAba.toUpperCase()) || aba.getLastRow() <= 1) {
      continue; 
    }
    funcionariosSet.add(nomeDaAba); 
    const valores = aba.getDataRange().getValues();
    for (let i = 1; i < valores.length; i++) { 
      const linha = valores[i];
      let dataVenda = linha[0];
      if (dataVenda && typeof dataVenda.getMonth === 'function') {
        const statusVenda = linha[6];
        transacoes.push({ funcionario: nomeDaAba, tipo: 'venda', data: dataVenda.toISOString(), quantidade: linha[1], produto: linha[2], comprador: linha[3], valorUnitario: linha[4], valorTotal: linha[5], status: statusVenda });
        if (statusVenda) statusSet.add(statusVenda);
      }
      let dataGasto = linha[8];
      if (dataGasto && typeof dataGasto.getMonth === 'function') {
        const statusGasto = linha[13];
        transacoes.push({ funcionario: nomeDaAba, tipo: 'gasto', data: dataGasto.toISOString(), quantidade: linha[9], compra: linha[10], valorUnitario: linha[11], valorTotal: linha[12], status: statusGasto, fornecedor: linha[14] });
        if (statusGasto) statusSet.add(statusGasto);
      }
    }
  }
  const resultado = { transacoes, funcionarios: [...funcionariosSet], produtos: [...produtosSet], compras: [...comprasSet], compradores: [...compradoresSet], fornecedores: [...fornecedoresSet], status: [...statusSet] };
  putInCache(cacheKey, resultado);
  return resultado;
}

function gerarPaginaDeFechamento(authToken, dadosFiltrados, nomeFuncionarioSelecionado, nomeCompradorSelecionado, nomeFornecedorSelecionado, tipoDeVisualizacaoAtual, nomeCliente, dataInicio, dataFim) {
  if (!isTokenValido(authToken)) return `<h1>Acesso não autorizado.</h1>`;
  
  dadosFiltrados.sort((a, b) => new Date(a.data) - new Date(b.data));

  const totalGanhos = dadosFiltrados.filter(d => d.tipo === 'venda').reduce((acc, d) => acc + (Number(d.valorTotal) || 0), 0);
  const totalGastos = dadosFiltrados.filter(d => d.tipo === 'gasto').reduce((acc, d) => acc + (Number(d.valorTotal) || 0), 0);
  const saldoFinal = totalGanhos - totalGastos;
  
  const formatarMoedaRelatorio = (valor) => {
    if (valor === null || valor === undefined || isNaN(valor)) return '-';
    return (Number(valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace('\u00A0', ' ');
  };

  const formatarDataSimples = (dataString) => {
    if (!dataString) return '';
    const [ano, mes, dia] = dataString.split('-');
    return `${dia}/${mes}/${ano}`;
  };

  let tituloDoRelatorio = '';
  let periodoDoRelatorio = '';
  let nomeDaEmpresa = '';
  let entidadePrincipal = '';
  let cabecalhoTabela;
  let linhasTabela;

  if (dataInicio && dataFim) {
    periodoDoRelatorio = `<h2 class="periodo">Período: ${formatarDataSimples(dataInicio)} a ${formatarDataSimples(dataFim)}</h2>`;
  }

  const isRelatorioVendaEspecifica = tipoDeVisualizacaoAtual === 'VENDAS' && nomeCompradorSelecionado !== 'TODOS';
  const isRelatorioGastoEspecifico = tipoDeVisualizacaoAtual === 'GASTOS' && nomeFornecedorSelecionado !== 'TODOS';

  if (isRelatorioVendaEspecifica) {
    tituloDoRelatorio = `<h1>Relatório de Fechamento - Venda</h1>`;
    nomeDaEmpresa = `<h2>${nomeCliente || ''}</h2>`;
    entidadePrincipal = `<h1 class="titulo-destaque">${nomeCompradorSelecionado.toUpperCase()}</h1>`;
    cabecalhoTabela = `<tr><th>Data</th><th>Quantidade</th><th>Produto</th><th>Valor Unitário</th><th>Valor Total</th><th>Status</th></tr>`;
    linhasTabela = dadosFiltrados
      .filter(item => item.tipo === 'venda')
      .map(item => `<tr><td>${new Date(item.data).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</td><td>${item.quantidade || ''}</td><td>${item.produto || ''}</td><td>${formatarMoedaRelatorio(item.valorUnitario)}</td><td style="color:green;">${formatarMoedaRelatorio(item.valorTotal)}</td><td>${item.status || ''}</td></tr>`).join('');
  
  } else if (isRelatorioGastoEspecifico) {
    tituloDoRelatorio = `<h1>Relatório de Fechamento - Compra</h1>`;
    nomeDaEmpresa = `<h2>${nomeCliente || ''}</h2>`;
    entidadePrincipal = `<h1 class="titulo-destaque">${nomeFornecedorSelecionado.toUpperCase()}</h1>`;
    cabecalhoTabela = `<tr><th>Data</th><th>Quantidade</th><th>Compra</th><th>Valor Unitário</th><th>Valor Total</th><th>Status</th></tr>`;
    linhasTabela = dadosFiltrados
      .filter(item => item.tipo === 'gasto')
      .map(item => `<tr><td>${new Date(item.data).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</td><td>${item.quantidade || ''}</td><td>${item.compra || ''}</td><td>${formatarMoedaRelatorio(item.valorUnitario)}</td><td style="color:red;">${formatarMoedaRelatorio(item.valorTotal)}</td><td>${item.status || ''}</td></tr>`).join('');

  } else if (nomeFuncionarioSelecionado !== 'TODOS') {
    if (tipoDeVisualizacaoAtual === 'VENDAS') {
      tituloDoRelatorio = `<h1>Relatório de Fechamento - Venda</h1>`;
      cabecalhoTabela = `<tr><th>Data</th><th>Quantidade</th><th>Produto</th><th>Comprador</th><th>Valor Unitário</th><th>Valor Total</th><th>Status</th></tr>`;
      linhasTabela = dadosFiltrados.filter(i => i.tipo === 'venda').map(item => `<tr><td>${new Date(item.data).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</td><td>${item.quantidade || ''}</td><td>${item.produto || ''}</td><td>${item.comprador || ''}</td><td>${formatarMoedaRelatorio(item.valorUnitario)}</td><td style="color:green;">${formatarMoedaRelatorio(item.valorTotal)}</td><td>${item.status || ''}</td></tr>`).join('');
    } else if (tipoDeVisualizacaoAtual === 'GASTOS') {
      tituloDoRelatorio = `<h1>Relatório de Fechamento - Compra</h1>`;
      cabecalhoTabela = `<tr><th>Data</th><th>Quantidade</th><th>Compra</th><th>Fornecedor</th><th>Valor Unitário</th><th>Valor Total</th><th>Status</th></tr>`;
      linhasTabela = dadosFiltrados.filter(i => i.tipo === 'gasto').map(item => `<tr><td>${new Date(item.data).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</td><td>${item.quantidade || ''}</td><td>${item.compra || ''}</td><td>${item.fornecedor || ''}</td><td>${formatarMoedaRelatorio(item.valorUnitario)}</td><td style="color:red;">${formatarMoedaRelatorio(item.valorTotal)}</td><td>${item.status || ''}</td></tr>`).join('');
    } else { // 'GERAL' para funcionário específico
      tituloDoRelatorio = `<h1>Relatório de Fechamento</h1>`;
      cabecalhoTabela = `<tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Quantidade</th><th>Comprador/Fornecedor</th><th>Valor Unitário</th><th>Valor Total</th><th>Status</th></tr>`;
      linhasTabela = dadosFiltrados.map(item => {
          let compradorOuFornecedor = item.tipo === 'venda' ? (item.comprador || '') : (item.fornecedor || '');
          let descricao = item.tipo === 'venda' ? (item.produto || '') : (item.compra || '');
          return `<tr><td>${new Date(item.data).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</td><td>${item.tipo === 'venda' ? 'Venda' : 'Gasto'}</td><td>${descricao}</td><td>${item.quantidade || ''}</td><td>${compradorOuFornecedor}</td><td>${formatarMoedaRelatorio(item.valorUnitario)}</td><td style="color:${item.tipo === 'venda' ? 'green' : 'red'};">${formatarMoedaRelatorio(item.valorTotal)}</td><td>${item.status || ''}</td></tr>`;
        }).join('');
    }
    entidadePrincipal = `<h1 class="titulo-destaque">${nomeFuncionarioSelecionado.toUpperCase()}</h1>`;
  
  } else { // Relatório Geral de 'TODOS' os funcionários
    tituloDoRelatorio = `<h1>Relatório de Fechamento - Geral</h1>`;
    nomeDaEmpresa = `<h2>${nomeCliente || ''}</h2>`;
    const cabecalhoFuncionario = '<th>Funcionário</th>';
    const celulaFuncionario = (item) => `<td>${item.funcionario || ''}</td>`;
    
    if (tipoDeVisualizacaoAtual === 'VENDAS') {
      cabecalhoTabela = `<tr><th>Data</th>${cabecalhoFuncionario}<th>Quantidade</th><th>Produto</th><th>Comprador</th><th>Valor Unitário</th><th>Valor Total</th><th>Status</th></tr>`;
      linhasTabela = dadosFiltrados.filter(i => i.tipo === 'venda').map(item => `<tr><td>${new Date(item.data).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</td>${celulaFuncionario(item)}<td>${item.quantidade || ''}</td><td>${item.produto || ''}</td><td>${item.comprador || ''}</td><td>${formatarMoedaRelatorio(item.valorUnitario)}</td><td style="color:green;">${formatarMoedaRelatorio(item.valorTotal)}</td><td>${item.status || ''}</td></tr>`).join('');
    } else if (tipoDeVisualizacaoAtual === 'GASTOS') {
      cabecalhoTabela = `<tr><th>Data</th>${cabecalhoFuncionario}<th>Quantidade</th><th>Compra</th><th>Fornecedor</th><th>Valor Unitário</th><th>Valor Total</th><th>Status</th></tr>`;
      linhasTabela = dadosFiltrados.filter(i => i.tipo === 'gasto').map(item => `<tr><td>${new Date(item.data).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</td>${celulaFuncionario(item)}<td>${item.quantidade || ''}</td><td>${item.compra || ''}</td><td>${item.fornecedor || ''}</td><td>${formatarMoedaRelatorio(item.valorUnitario)}</td><td style="color:red;">${formatarMoedaRelatorio(item.valorTotal)}</td><td>${item.status || ''}</td></tr>`).join('');
    } else { // GERAL de TODOS
      cabecalhoTabela = `<tr><th>Data</th>${cabecalhoFuncionario}<th>Tipo</th><th>Descrição</th><th>Quantidade</th><th>Comprador/Fornecedor</th><th>Valor Unitário</th><th>Valor Total</th><th>Status</th></tr>`;
      linhasTabela = dadosFiltrados.map(item => {
        let compradorOuFornecedor = item.tipo === 'venda' ? (item.comprador || '') : (item.fornecedor || '');
        let descricao = item.tipo === 'venda' ? (item.produto || '') : (item.compra || '');
        return `<tr><td>${new Date(item.data).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</td>${celulaFuncionario(item)}<td>${item.tipo === 'venda' ? 'Venda' : 'Gasto'}</td><td>${descricao}</td><td>${item.quantidade || ''}</td><td>${compradorOuFornecedor}</td><td>${formatarMoedaRelatorio(item.valorUnitario)}</td><td style="color:${item.tipo === 'venda' ? 'green' : 'red'};">${formatarMoedaRelatorio(item.valorTotal)}</td><td>${item.status || ''}</td></tr>`;
      }).join('');
    }
  }
  
  const logoUrl = "https://i.postimg.cc/Qd98gFMF/Sistema-ARK.webp";
  const telefoneContato = "(22) 98847-2248";

  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Relatório de Fechamento</title>
        <style> 
          body { font-family: Arial, sans-serif; margin: 20px; } 
          table { width: 100%; border-collapse: collapse; margin-top: 20px; } 
          th, td { border: 1px solid #ccc; padding: 8px; text-align: left; } 
          th { background-color: #f2f2f2; } 
          h1 { margin: 0; color: #333; font-size: 1.8em; } 
          h2 { margin: 5px 0 0 0; color: #555; font-weight: normal; font-size: 1.2em; } 
          .periodo { font-size: 1.1em; font-weight: bold; color: #333; margin-top: 15px; border-top: 1px solid #eee; padding-top: 15px; }
          .titulo-destaque { margin: 10px 0 0 0; font-size: 2.2em; color: #000; }
          .report-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 25px; border-bottom: 2px solid #ccc; padding-bottom: 15px; } 
          .report-header .title-section { text-align: left; flex-grow: 1; } 
          .report-header .contact-section { text-align: right; } 
          .report-header .contact-section img { width: 100px; opacity: 0.8; } 
          .report-header .contact-section p { margin: 8px 0 0 0; font-weight: bold; color: #333; } 
          .resumo { margin-top: 20px; padding: 15px; border: 1px solid #ccc; background: #f9f9f9; border-radius: 8px; } 
          .resumo h2 { font-size: 1.4em; text-align: left; } 
          .resumo p { margin: 5px 0; font-size: 1.1em; } 
          .resumo strong { color: #555; } 
          .print-button-container { text-align: center; margin-bottom: 20px; } 
          .print-button { background-color: #6d28d9; color: white; border: none; padding: 12px 25px; border-radius: 6px; font-size: 16px; font-weight: bold; cursor: pointer; } 
          @media print { .no-print { display: none !important; } } 
        </style>
    </head>
    <body>
        <header class="report-header">
            <div class="title-section">
                ${tituloDoRelatorio}
                ${periodoDoRelatorio}
                ${nomeDaEmpresa}
                ${entidadePrincipal}
            </div>
            <div class="contact-section">
                <img src="${logoUrl}" alt="Logo">
                <p>${telefoneContato}</p>
            </div>
        </header>
        <div class="print-button-container no-print"> <button class="print-button" onclick="window.print()">Imprimir / Salvar PDF</button> </div>
        <table> <thead>${cabecalhoTabela}</thead> <tbody>${linhasTabela}</tbody> </table>
        <div class="resumo"> 
          <h2>Resumo Financeiro</h2> 
          <p><strong>Total de Ganhos:</strong> ${formatarMoedaRelatorio(totalGanhos)}</p> 
          <p><strong>Total de Gastos:</strong> ${formatarMoedaRelatorio(totalGastos)}</p> 
          <hr> 
          <p><strong>Saldo Final:</strong> ${formatarMoedaRelatorio(saldoFinal)}</p> 
        </div>
    </body>
    </html>
  `;
}