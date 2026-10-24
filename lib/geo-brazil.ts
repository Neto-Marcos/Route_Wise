/**
 * lib/geo-brazil.ts
 *
 * In-Memory Brazilian Geographic Dictionary & Spatial Distance Engine
 * Criar Rota TMS — Automated Routing Engine
 *
 * Provides:
 * 1. O(1) in-memory coordinate resolution (< 0.05ms) for >110 key logistics hubs and municipalities.
 * 2. Robust string normalization handling "Campinas - SP", "São Paulo/SP", accents, CEPs and aliases.
 * 3. Numerically stable Haversine distance calculator and road tortuosity estimator.
 * 4. Micro-jitter spatial disperser preventing exact map marker collisions.
 * 5. Universal Worker request/response message contracts for background execution.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface HubLocation extends GeoPoint {
  name: string;
  uf: string;
  region?: string;
  isCapital?: boolean;
  isLogisticsHub?: boolean;
}

export type ResolutionConfidence =
  | "exact_coordinates"
  | "city_uf_exact"
  | "alias_match"
  | "city_exact"
  | "cep_prefix"
  | "fuzzy_match"
  | "state_capital"
  | "default_depot";

export interface ResolvedLocation extends GeoPoint {
  name: string;
  uf: string;
  confidence: ResolutionConfidence;
  approximate: boolean;
  matchedKey?: string;
  source: string;
}

export interface ResolveLocationInput {
  city?: string | null;
  uf?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  indexInBatch?: number; // Usado para aplicar micro-jitter se necessário
}

// ---------------------------------------------------------------------------
// 1. Dicionário de Hubs Logísticos e Cidades do Brasil
// ---------------------------------------------------------------------------

export const DEFAULT_DEPOT: HubLocation = {
  lat: -23.5505,
  lng: -46.6333,
  name: "Centro de Distribuição Principal",
  uf: "SP",
  region: "Grande São Paulo",
  isLogisticsHub: true,
};

export const BRAZILIAN_HUBS: Record<string, HubLocation> = {
  // --- São Paulo: Região Metropolitana de Campinas (RMC) ---
  campinas_sp: { lat: -22.9099, lng: -47.0626, name: "Campinas", uf: "SP", region: "RMC", isLogisticsHub: true },
  sumare_sp: { lat: -22.8208, lng: -47.2669, name: "Sumaré", uf: "SP", region: "RMC", isLogisticsHub: true },
  hortolandia_sp: { lat: -22.8583, lng: -47.2200, name: "Hortolândia", uf: "SP", region: "RMC", isLogisticsHub: true },
  paulinia_sp: { lat: -22.7614, lng: -47.1542, name: "Paulínia", uf: "SP", region: "RMC", isLogisticsHub: true },
  americana_sp: { lat: -22.7375, lng: -47.3331, name: "Americana", uf: "SP", region: "RMC", isLogisticsHub: true },
  santa_barbara_doeste_sp: { lat: -22.7556, lng: -47.4147, name: "Santa Bárbara d'Oeste", uf: "SP", region: "RMC" },
  valinhos_sp: { lat: -22.9706, lng: -46.9961, name: "Valinhos", uf: "SP", region: "RMC" },
  vinhedo_sp: { lat: -23.0297, lng: -46.9747, name: "Vinhedo", uf: "SP", region: "RMC", isLogisticsHub: true },
  indaiatuba_sp: { lat: -23.0903, lng: -47.2181, name: "Indaiatuba", uf: "SP", region: "RMC", isLogisticsHub: true },
  jaguariuna_sp: { lat: -22.7056, lng: -46.9856, name: "Jaguariúna", uf: "SP", region: "RMC" },
  cosmopolis_sp: { lat: -22.6467, lng: -47.1961, name: "Cosmópolis", uf: "SP", region: "RMC" },
  nova_odessa_sp: { lat: -22.7806, lng: -47.2944, name: "Nova Odessa", uf: "SP", region: "RMC" },
  monte_mor_sp: { lat: -22.9472, lng: -47.3156, name: "Monte Mor", uf: "SP", region: "RMC" },
  itatiba_sp: { lat: -23.0058, lng: -46.8428, name: "Itatiba", uf: "SP", region: "RMC" },
  holambra_sp: { lat: -22.6333, lng: -47.0500, name: "Holambra", uf: "SP", region: "RMC" },
  artur_nogueira_sp: { lat: -22.5728, lng: -47.1728, name: "Artur Nogueira", uf: "SP", region: "RMC" },
  pedreira_sp: { lat: -22.7417, lng: -46.9014, name: "Pedreira", uf: "SP", region: "RMC" },

  // --- São Paulo: Cinturão Logístico de Jundiaí & Cajamar ---
  cajamar_sp: { lat: -23.3556, lng: -46.8778, name: "Cajamar", uf: "SP", region: "Jundiaí", isLogisticsHub: true },
  jundiai_sp: { lat: -23.1857, lng: -46.8978, name: "Jundiaí", uf: "SP", region: "Jundiaí", isLogisticsHub: true },
  louveira_sp: { lat: -23.0856, lng: -46.9508, name: "Louveira", uf: "SP", region: "Jundiaí", isLogisticsHub: true },
  itupeva_sp: { lat: -23.1531, lng: -47.0578, name: "Itupeva", uf: "SP", region: "Jundiaí" },
  cabreuva_sp: { lat: -23.3075, lng: -47.1331, name: "Cabreúva", uf: "SP", region: "Jundiaí" },
  varzea_paulista_sp: { lat: -23.2119, lng: -46.8286, name: "Várzea Paulista", uf: "SP", region: "Jundiaí" },
  campo_limpo_paulista_sp: { lat: -23.2056, lng: -46.7861, name: "Campo Limpo Paulista", uf: "SP", region: "Jundiaí" },
  jarinu_sp: { lat: -23.1006, lng: -46.7281, name: "Jarinu", uf: "SP", region: "Jundiaí" },

  // --- São Paulo: Grande São Paulo (RMSP) ---
  sao_paulo_sp: { lat: -23.5505, lng: -46.6333, name: "São Paulo", uf: "SP", region: "Grande SP", isCapital: true, isLogisticsHub: true },
  guarulhos_sp: { lat: -23.4628, lng: -46.5333, name: "Guarulhos", uf: "SP", region: "Grande SP", isLogisticsHub: true },
  sao_bernardo_do_campo_sp: { lat: -23.6914, lng: -46.5646, name: "São Bernardo do Campo", uf: "SP", region: "Grande SP", isLogisticsHub: true },
  santo_andre_sp: { lat: -23.6639, lng: -46.5383, name: "Santo André", uf: "SP", region: "Grande SP" },
  sao_caetano_do_sul_sp: { lat: -23.6228, lng: -46.5550, name: "São Caetano do Sul", uf: "SP", region: "Grande SP" },
  diadema_sp: { lat: -23.6864, lng: -46.6228, name: "Diadema", uf: "SP", region: "Grande SP" },
  maua_sp: { lat: -23.6678, lng: -46.4614, name: "Mauá", uf: "SP", region: "Grande SP" },
  osasco_sp: { lat: -23.5325, lng: -46.7917, name: "Osasco", uf: "SP", region: "Grande SP", isLogisticsHub: true },
  barueri_sp: { lat: -23.5108, lng: -46.8761, name: "Barueri", uf: "SP", region: "Grande SP", isLogisticsHub: true },
  santana_de_parnaiba_sp: { lat: -23.4439, lng: -46.9181, name: "Santana de Parnaíba", uf: "SP", region: "Grande SP" },
  cotia_sp: { lat: -23.6039, lng: -46.9189, name: "Cotia", uf: "SP", region: "Grande SP" },
  carapicuiba_sp: { lat: -23.5222, lng: -46.8356, name: "Carapicuíba", uf: "SP", region: "Grande SP" },
  itapevi_sp: { lat: -23.5489, lng: -46.9342, name: "Itapevi", uf: "SP", region: "Grande SP" },
  jandira_sp: { lat: -23.5278, lng: -46.9028, name: "Jandira", uf: "SP", region: "Grande SP" },
  taboao_da_serra_sp: { lat: -23.6261, lng: -46.7583, name: "Taboão da Serra", uf: "SP", region: "Grande SP" },
  embu_das_artes_sp: { lat: -23.6489, lng: -46.8522, name: "Embu das Artes", uf: "SP", region: "Grande SP", isLogisticsHub: true },
  itapecerica_da_serra_sp: { lat: -23.7172, lng: -46.8492, name: "Itapecerica da Serra", uf: "SP", region: "Grande SP" },
  mogi_das_cruzes_sp: { lat: -23.5206, lng: -46.1853, name: "Mogi das Cruzes", uf: "SP", region: "Grande SP" },
  suzano_sp: { lat: -23.5425, lng: -46.3108, name: "Suzano", uf: "SP", region: "Grande SP" },
  poa_sp: { lat: -23.5283, lng: -46.3456, name: "Poá", uf: "SP", region: "Grande SP" },
  ferraz_de_vasconcelos_sp: { lat: -23.5414, lng: -46.3683, name: "Ferraz de Vasconcelos", uf: "SP", region: "Grande SP" },
  itaquaquecetuba_sp: { lat: -23.4864, lng: -46.3483, name: "Itaquaquecetuba", uf: "SP", region: "Grande SP" },
  aruja_sp: { lat: -23.3967, lng: -46.3208, name: "Arujá", uf: "SP", region: "Grande SP" },
  caieiras_sp: { lat: -23.3644, lng: -46.7408, name: "Caieiras", uf: "SP", region: "Grande SP" },
  franco_da_rocha_sp: { lat: -23.3289, lng: -46.7269, name: "Franco da Rocha", uf: "SP", region: "Grande SP" },
  francisco_morato_sp: { lat: -23.2817, lng: -46.7439, name: "Francisco Morato", uf: "SP", region: "Grande SP" },

  // --- São Paulo: Baixada Santista ---
  santos_sp: { lat: -23.9608, lng: -46.3331, name: "Santos", uf: "SP", region: "Baixada Santista", isLogisticsHub: true },
  sao_vicente_sp: { lat: -23.9631, lng: -46.3919, name: "São Vicente", uf: "SP", region: "Baixada Santista" },
  praia_grande_sp: { lat: -24.0058, lng: -46.4028, name: "Praia Grande", uf: "SP", region: "Baixada Santista" },
  cubatao_sp: { lat: -23.8950, lng: -46.4253, name: "Cubatão", uf: "SP", region: "Baixada Santista", isLogisticsHub: true },
  guaruja_sp: { lat: -23.9936, lng: -46.2564, name: "Guarujá", uf: "SP", region: "Baixada Santista" },
  bertioga_sp: { lat: -23.8544, lng: -46.1383, name: "Bertioga", uf: "SP", region: "Baixada Santista" },

  // --- São Paulo: Vale do Paraíba & Litoral Norte ---
  sao_jose_dos_campos_sp: { lat: -23.1791, lng: -45.8872, name: "São José dos Campos", uf: "SP", region: "Vale do Paraíba", isLogisticsHub: true },
  taubate_sp: { lat: -23.0264, lng: -45.5553, name: "Taubaté", uf: "SP", region: "Vale do Paraíba", isLogisticsHub: true },
  jacarei_sp: { lat: -23.3053, lng: -45.9658, name: "Jacareí", uf: "SP", region: "Vale do Paraíba" },
  pindamonhangaba_sp: { lat: -22.9247, lng: -45.4614, name: "Pindamonhangaba", uf: "SP", region: "Vale do Paraíba" },
  guaratingueta_sp: { lat: -22.8164, lng: -45.1931, name: "Guaratinguetá", uf: "SP", region: "Vale do Paraíba" },
  lorena_sp: { lat: -22.7331, lng: -45.1228, name: "Lorena", uf: "SP", region: "Vale do Paraíba" },
  cacapava_sp: { lat: -23.1008, lng: -45.7072, name: "Caçapava", uf: "SP", region: "Vale do Paraíba" },
  aparecida_sp: { lat: -22.8467, lng: -45.2289, name: "Aparecida", uf: "SP", region: "Vale do Paraíba" },
  caraguatatuba_sp: { lat: -23.6228, lng: -45.4128, name: "Caraguatatuba", uf: "SP", region: "Litoral Norte" },
  sao_sebastiao_sp: { lat: -23.7600, lng: -45.4097, name: "São Sebastião", uf: "SP", region: "Litoral Norte", isLogisticsHub: true },

  // --- São Paulo: Sorocaba & Região ---
  sorocaba_sp: { lat: -23.5015, lng: -47.4526, name: "Sorocaba", uf: "SP", region: "Sorocaba", isLogisticsHub: true },
  itu_sp: { lat: -23.2642, lng: -47.2992, name: "Itu", uf: "SP", region: "Sorocaba" },
  salto_sp: { lat: -23.2008, lng: -47.2869, name: "Salto", uf: "SP", region: "Sorocaba" },
  votorantim_sp: { lat: -23.5414, lng: -47.4378, name: "Votorantim", uf: "SP", region: "Sorocaba" },
  sao_roque_sp: { lat: -23.5322, lng: -47.1350, name: "São Roque", uf: "SP", region: "Sorocaba" },
  ibiuna_sp: { lat: -23.6567, lng: -47.2228, name: "Ibiúna", uf: "SP", region: "Sorocaba" },
  boituva_sp: { lat: -23.2839, lng: -47.6711, name: "Boituva", uf: "SP", region: "Sorocaba" },
  tatui_sp: { lat: -23.3556, lng: -47.8567, name: "Tatuí", uf: "SP", region: "Sorocaba" },
  itapetininga_sp: { lat: -23.5878, lng: -48.0531, name: "Itapetininga", uf: "SP", region: "Sorocaba" },

  // --- São Paulo: Interior, Central & Mogiana ---
  piracicaba_sp: { lat: -22.7253, lng: -47.6492, name: "Piracicaba", uf: "SP", region: "Central", isLogisticsHub: true },
  limeira_sp: { lat: -22.5647, lng: -47.4017, name: "Limeira", uf: "SP", region: "Central", isLogisticsHub: true },
  rio_claro_sp: { lat: -22.4114, lng: -47.5614, name: "Rio Claro", uf: "SP", region: "Central" },
  araras_sp: { lat: -22.3572, lng: -47.3842, name: "Araras", uf: "SP", region: "Central" },
  leme_sp: { lat: -22.1861, lng: -47.3900, name: "Leme", uf: "SP", region: "Central" },
  mogi_guacu_sp: { lat: -22.3708, lng: -46.9428, name: "Mogi Guaçu", uf: "SP", region: "Mogiana" },
  mogi_mirim_sp: { lat: -22.4319, lng: -46.9581, name: "Mogi Mirim", uf: "SP", region: "Mogiana" },
  sao_carlos_sp: { lat: -22.0175, lng: -47.8908, name: "São Carlos", uf: "SP", region: "Central", isLogisticsHub: true },
  araraquara_sp: { lat: -21.7944, lng: -48.1756, name: "Araraquara", uf: "SP", region: "Central", isLogisticsHub: true },
  matao_sp: { lat: -21.6033, lng: -48.3644, name: "Matão", uf: "SP", region: "Central" },
  ribeirao_preto_sp: { lat: -21.1767, lng: -47.8208, name: "Ribeirão Preto", uf: "SP", region: "Norte SP", isLogisticsHub: true },
  sertaozinho_sp: { lat: -21.1356, lng: -47.9889, name: "Sertãozinho", uf: "SP", region: "Norte SP" },
  franca_sp: { lat: -20.5386, lng: -47.4008, name: "Franca", uf: "SP", region: "Norte SP", isLogisticsHub: true },
  barretos_sp: { lat: -20.5572, lng: -48.5678, name: "Barretos", uf: "SP", region: "Norte SP" },
  bebedouro_sp: { lat: -20.9492, lng: -48.4792, name: "Bebedouro", uf: "SP", region: "Norte SP" },
  bauru_sp: { lat: -22.3147, lng: -49.0606, name: "Bauru", uf: "SP", region: "Centro-Oeste SP", isLogisticsHub: true },
  jau_sp: { lat: -22.2961, lng: -48.5586, name: "Jaú", uf: "SP", region: "Centro-Oeste SP" },
  botucatu_sp: { lat: -22.8858, lng: -48.4450, name: "Botucatu", uf: "SP", region: "Centro-Oeste SP" },
  marilia_sp: { lat: -22.2139, lng: -49.9458, name: "Marília", uf: "SP", region: "Oeste SP", isLogisticsHub: true },
  assis_sp: { lat: -22.6617, lng: -50.4189, name: "Assis", uf: "SP", region: "Oeste SP" },
  ourinhos_sp: { lat: -22.9789, lng: -49.8706, name: "Ourinhos", uf: "SP", region: "Oeste SP" },
  presidente_prudente_sp: { lat: -22.1256, lng: -51.3889, name: "Presidente Prudente", uf: "SP", region: "Oeste SP", isLogisticsHub: true },
  sao_jose_do_rio_preto_sp: { lat: -20.8114, lng: -49.3758, name: "São José do Rio Preto", uf: "SP", region: "Noroeste SP", isLogisticsHub: true },
  catanduva_sp: { lat: -21.1378, lng: -48.9728, name: "Catanduva", uf: "SP", region: "Noroeste SP" },
  votuporanga_sp: { lat: -20.4239, lng: -49.9781, name: "Votuporanga", uf: "SP", region: "Noroeste SP" },
  aracatuba_sp: { lat: -21.2089, lng: -50.4328, name: "Araçatuba", uf: "SP", region: "Noroeste SP", isLogisticsHub: true },
  birigui_sp: { lat: -21.2889, lng: -50.3400, name: "Birigui", uf: "SP", region: "Noroeste SP" },

  // --- 27 Capitais Brasileiras ---
  rio_de_janeiro_rj: { lat: -22.9068, lng: -43.1729, name: "Rio de Janeiro", uf: "RJ", isCapital: true, isLogisticsHub: true },
  belo_horizonte_mg: { lat: -19.9167, lng: -43.9345, name: "Belo Horizonte", uf: "MG", isCapital: true, isLogisticsHub: true },
  vitoria_es: { lat: -20.3155, lng: -40.3128, name: "Vitória", uf: "ES", isCapital: true, isLogisticsHub: true },
  curitiba_pr: { lat: -25.4290, lng: -49.2671, name: "Curitiba", uf: "PR", isCapital: true, isLogisticsHub: true },
  florianopolis_sc: { lat: -27.5954, lng: -48.5480, name: "Florianópolis", uf: "SC", isCapital: true },
  porto_alegre_rs: { lat: -30.0346, lng: -51.2177, name: "Porto Alegre", uf: "RS", isCapital: true, isLogisticsHub: true },
  brasilia_df: { lat: -15.7975, lng: -47.8919, name: "Brasília", uf: "DF", isCapital: true, isLogisticsHub: true },
  goiania_go: { lat: -16.6869, lng: -49.2648, name: "Goiânia", uf: "GO", isCapital: true, isLogisticsHub: true },
  cuiaba_mt: { lat: -15.6014, lng: -56.0979, name: "Cuiabá", uf: "MT", isCapital: true, isLogisticsHub: true },
  campo_grande_ms: { lat: -20.4697, lng: -54.6201, name: "Campo Grande", uf: "MS", isCapital: true, isLogisticsHub: true },
  salvador_ba: { lat: -12.9777, lng: -38.5016, name: "Salvador", uf: "BA", isCapital: true, isLogisticsHub: true },
  recife_pe: { lat: -8.0476, lng: -34.8770, name: "Recife", uf: "PE", isCapital: true, isLogisticsHub: true },
  fortaleza_ce: { lat: -3.7319, lng: -38.5267, name: "Fortaleza", uf: "CE", isCapital: true, isLogisticsHub: true },
  natal_rn: { lat: -5.7945, lng: -35.2110, name: "Natal", uf: "RN", isCapital: true },
  joao_pessoa_pb: { lat: -7.1195, lng: -34.8450, name: "João Pessoa", uf: "PB", isCapital: true },
  campina_grande_pb: { lat: -7.2247, lng: -35.8771, name: "Campina Grande", uf: "PB", isLogisticsHub: true },
  patos_pb: { lat: -7.0245, lng: -37.2800, name: "Patos", uf: "PB" },
  sousa_pb: { lat: -6.7611, lng: -38.2281, name: "Sousa", uf: "PB" },
  cajazeiras_pb: { lat: -6.8889, lng: -38.5606, name: "Cajazeiras", uf: "PB" },
  maceio_al: { lat: -9.6498, lng: -35.7089, name: "Maceió", uf: "AL", isCapital: true },
  aracaju_se: { lat: -10.9472, lng: -37.0731, name: "Aracaju", uf: "SE", isCapital: true },
  sao_luis_ma: { lat: -2.5307, lng: -44.3068, name: "São Luís", uf: "MA", isCapital: true, isLogisticsHub: true },
  teresina_pi: { lat: -5.0920, lng: -42.8038, name: "Teresina", uf: "PI", isCapital: true },
  belem_pa: { lat: -1.4558, lng: -48.5044, name: "Belém", uf: "PA", isCapital: true, isLogisticsHub: true },
  manaus_am: { lat: -3.1190, lng: -60.0217, name: "Manaus", uf: "AM", isCapital: true, isLogisticsHub: true },
  porto_velho_ro: { lat: -8.7619, lng: -63.9039, name: "Porto Velho", uf: "RO", isCapital: true, isLogisticsHub: true },
  rio_branco_ac: { lat: -9.9753, lng: -67.8249, name: "Rio Branco", uf: "AC", isCapital: true },
  macapa_ap: { lat: 0.0356, lng: -51.0705, name: "Macapá", uf: "AP", isCapital: true },
  boa_vista_rr: { lat: 2.8235, lng: -60.6758, name: "Boa Vista", uf: "RR", isCapital: true },
  palmas_to: { lat: -10.2491, lng: -48.3243, name: "Palmas", uf: "TO", isCapital: true },

  // --- Principais Hubs Interestaduais e Pólos Industriais ---
  extrema_mg: { lat: -22.8550, lng: -46.3178, name: "Extrema", uf: "MG", isLogisticsHub: true },
  betim_mg: { lat: -19.9678, lng: -44.1983, name: "Betim", uf: "MG", isLogisticsHub: true },
  contagem_mg: { lat: -19.9317, lng: -44.0536, name: "Contagem", uf: "MG", isLogisticsHub: true },
  uberlandia_mg: { lat: -18.9186, lng: -48.2772, name: "Uberlândia", uf: "MG", isLogisticsHub: true },
  uberaba_mg: { lat: -19.7472, lng: -47.9392, name: "Uberaba", uf: "MG" },
  pouso_alegre_mg: { lat: -22.2300, lng: -45.9364, name: "Pouso Alegre", uf: "MG", isLogisticsHub: true },
  pocos_de_caldas_mg: { lat: -21.7850, lng: -46.5619, name: "Poços de Caldas", uf: "MG" },
  juiz_de_fora_mg: { lat: -21.7642, lng: -43.3497, name: "Juiz de Fora", uf: "MG", isLogisticsHub: true },

  duque_de_caxias_rj: { lat: -22.7856, lng: -43.3117, name: "Duque de Caxias", uf: "RJ", isLogisticsHub: true },
  nova_iguacu_rj: { lat: -22.7556, lng: -43.4603, name: "Nova Iguaçu", uf: "RJ" },
  niteroi_rj: { lat: -22.8833, lng: -43.1036, name: "Niterói", uf: "RJ" },
  sao_goncalo_rj: { lat: -22.8269, lng: -43.0539, name: "São Gonçalo", uf: "RJ" },
  resende_rj: { lat: -22.4697, lng: -44.4467, name: "Resende", uf: "RJ", isLogisticsHub: true },
  volta_redonda_rj: { lat: -22.5231, lng: -44.1042, name: "Volta Redonda", uf: "RJ" },
  macae_rj: { lat: -22.3769, lng: -41.7869, name: "Macaé", uf: "RJ", isLogisticsHub: true },
  campos_dos_goytacazes_rj: { lat: -21.7622, lng: -41.3247, name: "Campos dos Goytacazes", uf: "RJ" },

  sao_jose_dos_pinhais_pr: { lat: -25.5347, lng: -49.2064, name: "São José dos Pinhais", uf: "PR", isLogisticsHub: true },
  londrina_pr: { lat: -23.3103, lng: -51.1628, name: "Londrina", uf: "PR", isLogisticsHub: true },
  maringa_pr: { lat: -23.4210, lng: -51.9331, name: "Maringá", uf: "PR", isLogisticsHub: true },
  ponta_grossa_pr: { lat: -25.0950, lng: -50.1619, name: "Ponta Grossa", uf: "PR", isLogisticsHub: true },
  cascavel_pr: { lat: -24.9558, lng: -53.4553, name: "Cascavel", uf: "PR", isLogisticsHub: true },
  foz_do_iguacu_pr: { lat: -25.5478, lng: -54.5881, name: "Foz do Iguaçu", uf: "PR" },
  paranagua_pr: { lat: -25.5206, lng: -48.5092, name: "Paranaguá", uf: "PR", isLogisticsHub: true },

  joinville_sc: { lat: -26.3045, lng: -48.8487, name: "Joinville", uf: "SC", isLogisticsHub: true },
  itajai_sc: { lat: -26.9078, lng: -48.6619, name: "Itajaí", uf: "SC", isLogisticsHub: true },
  navegantes_sc: { lat: -26.8981, lng: -48.6542, name: "Navegantes", uf: "SC", isLogisticsHub: true },
  blumenau_sc: { lat: -26.9194, lng: -49.0661, name: "Blumenau", uf: "SC" },
  sao_jose_sc: { lat: -27.6136, lng: -48.6367, name: "São José", uf: "SC" },
  chapeco_sc: { lat: -27.1006, lng: -52.6153, name: "Chapecó", uf: "SC", isLogisticsHub: true },

  caxias_do_sul_rs: { lat: -29.1678, lng: -51.1794, name: "Caxias do Sul", uf: "RS", isLogisticsHub: true },
  canoas_rs: { lat: -29.9189, lng: -51.1786, name: "Canoas", uf: "RS", isLogisticsHub: true },
  gravatai_rs: { lat: -29.9439, lng: -50.9928, name: "Gravataí", uf: "RS" },
  pelotas_rs: { lat: -31.7654, lng: -52.3376, name: "Pelotas", uf: "RS" },
  rio_grande_rs: { lat: -32.0350, lng: -52.0986, name: "Rio Grande", uf: "RS", isLogisticsHub: true },

  anapolis_go: { lat: -16.3267, lng: -48.9533, name: "Anápolis", uf: "GO", isLogisticsHub: true },
  aparecida_de_goiania_go: { lat: -16.8239, lng: -49.2439, name: "Aparecida de Goiânia", uf: "GO" },
  rio_verde_go: { lat: -17.7928, lng: -50.9192, name: "Rio Verde", uf: "GO", isLogisticsHub: true },

  serra_es: { lat: -20.1286, lng: -40.3078, name: "Serra", uf: "ES", isLogisticsHub: true },
  vila_velha_es: { lat: -20.3297, lng: -40.2925, name: "Vila Velha", uf: "ES" },
  cariacica_es: { lat: -20.2639, lng: -40.4200, name: "Cariacica", uf: "ES", isLogisticsHub: true },

  feira_de_santana_ba: { lat: -12.2664, lng: -38.9663, name: "Feira de Santana", uf: "BA", isLogisticsHub: true },
  camacari_ba: { lat: -12.6975, lng: -38.3242, name: "Camaçari", uf: "BA", isLogisticsHub: true },
  vitoria_da_conquista_ba: { lat: -14.8661, lng: -40.8394, name: "Vitória da Conquista", uf: "BA", isLogisticsHub: true },
  luis_eduardo_magalhaes_ba: { lat: -12.0950, lng: -45.7950, name: "Luís Eduardo Magalhães", uf: "BA", isLogisticsHub: true },

  cabo_de_santo_agostinho_pe: { lat: -8.2833, lng: -35.0333, name: "Cabo de Santo Agostinho", uf: "PE", isLogisticsHub: true },
  ipojuca_pe: { lat: -8.3989, lng: -35.0639, name: "Ipojuca", uf: "PE", isLogisticsHub: true },
  jaboatao_dos_guararapes_pe: { lat: -8.1131, lng: -35.0150, name: "Jaboatão dos Guararapes", uf: "PE" },
  caruaru_pe: { lat: -8.2833, lng: -35.9761, name: "Caruaru", uf: "PE", isLogisticsHub: true },
  petrolina_pe: { lat: -9.3986, lng: -40.5008, name: "Petrolina", uf: "PE", isLogisticsHub: true },

  maracanau_ce: { lat: -3.8767, lng: -38.6256, name: "Maracanaú", uf: "CE", isLogisticsHub: true },
  caucaia_ce: { lat: -3.7361, lng: -38.6531, name: "Caucaia", uf: "CE", isLogisticsHub: true },

  rondonopolis_mt: { lat: -16.4675, lng: -54.6358, name: "Rondonópolis", uf: "MT", isLogisticsHub: true },
  sinop_mt: { lat: -11.8608, lng: -55.5094, name: "Sinop", uf: "MT" },
  dourados_ms: { lat: -22.2231, lng: -54.8056, name: "Dourados", uf: "MS" },
  barcarena_pa: { lat: -1.5058, lng: -48.6258, name: "Barcarena", uf: "PA", isLogisticsHub: true },
};

// ---------------------------------------------------------------------------
// 2. Mapas de Índices O(1) e Dicionário de Sinônimos / Apelidos
// ---------------------------------------------------------------------------

const BY_CITY_UF = new Map<string, HubLocation>();
const BY_CITY = new Map<string, HubLocation>();
const CAPITALS_BY_UF = new Map<string, HubLocation>();

// Inicialização dos índices estáticos
for (const [key, hub] of Object.entries(BRAZILIAN_HUBS)) {
  BY_CITY_UF.set(key, hub);

  // Se a cidade não estiver no BY_CITY, ou se o hub for de SP ou Capital, dá prioridade
  const cityKey = key.replace(/_[a-z]{2}$/, "");
  if (!BY_CITY.has(cityKey) || hub.uf === "SP" || hub.isCapital) {
    BY_CITY.set(cityKey, hub);
  }

  if (hub.isCapital) {
    CAPITALS_BY_UF.set(hub.uf.toLowerCase(), hub);
  }
}

// Apelidos, siglas corriqueiras e variações regionais
export const HUB_ALIASES: Record<string, string> = {
  sampa: "sao_paulo_sp",
  sp: "sao_paulo_sp",
  rio: "rio_de_janeiro_rj",
  rj: "rio_de_janeiro_rj",
  bh: "belo_horizonte_mg",
  bsb: "brasilia_df",
  poa: "porto_alegre_rs",
  cwb: "curitiba_pr",
  ssa: "salvador_ba",
  rec: "recife_pe",
  vix: "vitoria_es",
  sjc: "sao_jose_dos_campos_sp",
  sbc: "sao_bernardo_do_campo_sp",
  sbdo: "sao_bernardo_do_campo_sp",
  sbo: "santa_barbara_doeste_sp",
  "santa barbara": "santa_barbara_doeste_sp",
  "santa barbara d oeste": "santa_barbara_doeste_sp",
  "santa barbara doeste": "santa_barbara_doeste_sp",
  "s barbara": "santa_barbara_doeste_sp",
  "s barbara doeste": "santa_barbara_doeste_sp",
  alphaville: "barueri_sp",
  tambore: "barueri_sp",
};

// Prefixo de 2 dígitos do CEP brasileiro mapeado para Hub Regional
const CEP_PREFIX_TO_KEY: Record<string, string> = {
  "01": "sao_paulo_sp",
  "02": "sao_paulo_sp",
  "03": "sao_paulo_sp",
  "04": "sao_paulo_sp",
  "05": "sao_paulo_sp",
  "06": "osasco_sp",
  "07": "guarulhos_sp",
  "08": "mogi_das_cruzes_sp",
  "09": "santo_andre_sp",
  "11": "santos_sp",
  "12": "sao_jose_dos_campos_sp",
  "13": "campinas_sp",
  "14": "ribeirao_preto_sp",
  "15": "sao_jose_do_rio_preto_sp",
  "16": "aracatuba_sp",
  "17": "bauru_sp",
  "18": "sorocaba_sp",
  "19": "presidente_prudente_sp",
  "20": "rio_de_janeiro_rj",
  "21": "rio_de_janeiro_rj",
  "22": "rio_de_janeiro_rj",
  "23": "rio_de_janeiro_rj",
  "24": "niteroi_rj",
  "25": "duque_de_caxias_rj",
  "27": "volta_redonda_rj",
  "28": "campos_dos_goytacazes_rj",
  "30": "belo_horizonte_mg",
  "31": "belo_horizonte_mg",
  "32": "contagem_mg",
  "33": "betim_mg",
  "35": "pouso_alegre_mg",
  "36": "juiz_de_fora_mg",
  "38": "uberlandia_mg",
  "70": "brasilia_df",
  "71": "brasilia_df",
  "72": "brasilia_df",
  "74": "goiania_go",
  "75": "anapolis_go",
  "80": "curitiba_pr",
  "81": "curitiba_pr",
  "83": "sao_jose_dos_pinhais_pr",
  "86": "londrina_pr",
  "87": "maringa_pr",
  "88": "florianopolis_sc",
  "89": "joinville_sc",
  "90": "porto_alegre_rs",
  "91": "porto_alegre_rs",
  "92": "canoas_rs",
  "95": "caxias_do_sul_rs",
  "40": "salvador_ba",
  "41": "salvador_ba",
  "44": "feira_de_santana_ba",
  "50": "recife_pe",
  "54": "jaboatao_dos_guararapes_pe",
  "55": "caruaru_pe",
  "60": "fortaleza_ce",
  "69": "manaus_am",
};

// ---------------------------------------------------------------------------
// 3. Normalização de Nomes e Strings
// ---------------------------------------------------------------------------

export const VALID_UFS = new Set([
  "ac", "al", "ap", "am", "ba", "ce", "df", "es", "go", "ma",
  "mt", "ms", "mg", "pa", "pb", "pr", "pe", "pi", "rj", "rn",
  "rs", "ro", "rr", "sc", "sp", "se", "to"
]);

export function cleanNormalized(str: string): string {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .toLowerCase()
    .replace(/['’`´]/g, "")          // apóstrofes
    .replace(/[^a-z0-9\s]/g, " ")     // pontuação vira espaço
    .replace(/\s+/g, " ")            // unifica espaços
    .trim();
}

export function parseCityAndUf(rawInput: string, defaultUf?: string | null): {
  normalizedCity: string;
  normalizedUf?: string;
  cepPrefix?: string;
  cleanName: string;
} {
  let text = (rawInput || "").trim();
  let foundUf = (defaultUf || "").trim().toLowerCase();
  let cepPrefix: string | undefined;

  // Extrai CEP se presente no texto
  const cepMatch = text.match(/\b(\d{5})[-.]?(\d{3})\b/);
  if (cepMatch) {
    cepPrefix = cepMatch[1];
    text = text.replace(cepMatch[0], " ");
  }

  // Extrai UF se vier formatado no final ("- SP", "/SP", ", SP", "(SP)")
  const ufMatch = text.match(/[\s\/\-,(]+([a-zA-Z]{2})[\s\)]*$/);
  if (ufMatch && VALID_UFS.has(ufMatch[1].toLowerCase())) {
    foundUf = ufMatch[1].toLowerCase();
    text = text.slice(0, ufMatch.index).trim();
  }

  let cleaned = cleanNormalized(text);

  // Expansão de abreviações corriqueiras
  cleaned = cleaned
    .replace(/\bmunicipio de\b/g, "")
    .replace(/\bcidade de\b/g, "")
    .replace(/\bdistrito de\b/g, "")
    .replace(/\bs\b\.?/g, "sao")
    .replace(/\bsto\b\.?/g, "santo")
    .replace(/\bsta\b\.?/g, "santa")
    .replace(/\s+/g, " ")
    .trim();

  // Substitui espaços por underline para bater com chaves do dicionário
  const normalizedCity = cleaned.replace(/\s+/g, "_");

  return {
    normalizedCity,
    normalizedUf: foundUf && VALID_UFS.has(foundUf) ? foundUf : undefined,
    cepPrefix,
    cleanName: cleaned,
  };
}

// ---------------------------------------------------------------------------
// 4. Utilitários de Distância (Haversine & Tortuosidade)
// ---------------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371;
export const ROAD_TORTUOSITY_FACTOR = 1.22;

export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  if (lat1 === lat2 && lng1 === lng2) return 0;

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const radLat1 = toRad(lat1);
  const radLat2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(radLat1) * Math.cos(radLat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const clampedA = Math.max(0, Math.min(1, a));
  const c = 2 * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));

  return Math.round(EARTH_RADIUS_KM * c * 100) / 100;
}

export function haversineDistance(p1: GeoPoint, p2: GeoPoint): number {
  return haversineDistanceKm(p1.lat, p1.lng, p2.lat, p2.lng);
}

export function estimateDrivingDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  tortuosity = ROAD_TORTUOSITY_FACTOR
): number {
  const straight = haversineDistanceKm(lat1, lng1, lat2, lng2);
  return Math.round(straight * tortuosity * 10) / 10;
}

export function calculateRouteTotalDistance(
  stops: GeoPoint[],
  circular = false
): number {
  if (stops.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    total += haversineDistanceKm(stops[i].lat, stops[i].lng, stops[i + 1].lat, stops[i + 1].lng);
  }
  if (circular && stops.length > 2) {
    total += haversineDistanceKm(
      stops[stops.length - 1].lat,
      stops[stops.length - 1].lng,
      stops[0].lat,
      stops[0].lng
    );
  }
  return Math.round(total * 100) / 100;
}

export function buildDistanceMatrix(points: GeoPoint[]): number[][] {
  const n = points.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dist = haversineDistanceKm(
        points[i].lat,
        points[i].lng,
        points[j].lat,
        points[j].lng
      );
      matrix[i][j] = dist;
      matrix[j][i] = dist;
    }
  }

  return matrix;
}

export function calculateCentroid(points: GeoPoint[]): GeoPoint {
  if (!points.length) return { lat: DEFAULT_DEPOT.lat, lng: DEFAULT_DEPOT.lng };
  let sumLat = 0;
  let sumLng = 0;
  for (const p of points) {
    sumLat += p.lat;
    sumLng += p.lng;
  }
  return {
    lat: sumLat / points.length,
    lng: sumLng / points.length,
  };
}

// ---------------------------------------------------------------------------
// 5. Motor de Resolução de Coordenadas em Cascata (< 5ms)
// ---------------------------------------------------------------------------

export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);
}

export function resolveLocation(input: ResolveLocationInput): ResolvedLocation {
  // 1. Coordenadas explícitas informadas na planilha
  if (isValidCoordinate(input.lat, input.lng)) {
    return {
      lat: Number(input.lat),
      lng: Number(input.lng),
      name: input.city || input.address || "Coordenada Informada",
      uf: (input.uf || "SP").toUpperCase(),
      confidence: "exact_coordinates",
      approximate: false,
      source: "spreadsheet_explicit_coords",
    };
  }

  // Prepara texto de busca combinando cidade, endereço ou fragmentos
  const targetText = input.city || input.address || "";
  const { normalizedCity, normalizedUf, cepPrefix, cleanName } = parseCityAndUf(
    targetText,
    input.uf
  );

  // Função auxiliar de dispersão para evitar sobreposição de marcadores no mapa
  const applyJitter = (base: HubLocation): GeoPoint => {
    if (typeof input.indexInBatch !== "number" || input.indexInBatch === 0) {
      return { lat: base.lat, lng: base.lng };
    }
    const idx = input.indexInBatch;
    // Dispersão em espiral de Arquimedes (~50 a 300 metros)
    const angle = idx * 137.5 * (Math.PI / 180);
    const radius = 0.00035 * Math.sqrt(idx);
    return {
      lat: base.lat + radius * Math.cos(angle),
      lng: base.lng + radius * Math.sin(angle),
    };
  };

  // 2. Busca exata Cidade + UF (ex: "campinas_sp")
  if (normalizedUf) {
    const fullKey = `${normalizedCity}_${normalizedUf}`;
    const hub = BY_CITY_UF.get(fullKey);
    if (hub) {
      const point = applyJitter(hub);
      return {
        lat: point.lat,
        lng: point.lng,
        name: hub.name,
        uf: hub.uf,
        confidence: "city_uf_exact",
        approximate: false,
        matchedKey: fullKey,
        source: "dictionary_city_uf",
      };
    }
  }

  // 3. Busca por Apelidos e Siglas (ex: "sjc", "alphaville", "santa barbara")
  const aliasTarget = cleanName.replace(/_/g, " ");
  if (HUB_ALIASES[aliasTarget]) {
    const targetKey = HUB_ALIASES[aliasTarget];
    const hub = BY_CITY_UF.get(targetKey);
    if (hub) {
      const point = applyJitter(hub);
      return {
        lat: point.lat,
        lng: point.lng,
        name: hub.name,
        uf: hub.uf,
        confidence: "alias_match",
        approximate: false,
        matchedKey: targetKey,
        source: "dictionary_alias",
      };
    }
  }

  // 4. Busca por Cidade isolada (se UF não fornecida ou não casada)
  const cityHub = BY_CITY.get(normalizedCity);
  if (cityHub) {
    const point = applyJitter(cityHub);
    return {
      lat: point.lat,
      lng: point.lng,
      name: cityHub.name,
      uf: cityHub.uf,
      confidence: "city_exact",
      approximate: false,
      matchedKey: normalizedCity,
      source: "dictionary_city",
    };
  }

  // 5. Busca por Prefixo de CEP (extraído de 13010-000 -> prefixo "13")
  if (cepPrefix) {
    const prefix2 = cepPrefix.slice(0, 2);
    const cepHubKey = CEP_PREFIX_TO_KEY[prefix2];
    if (cepHubKey && BY_CITY_UF.has(cepHubKey)) {
      const hub = BY_CITY_UF.get(cepHubKey)!;
      const point = applyJitter(hub);
      return {
        lat: point.lat,
        lng: point.lng,
        name: `${hub.name} (Região CEP ${cepPrefix})`,
        uf: hub.uf,
        confidence: "cep_prefix",
        approximate: true,
        matchedKey: cepHubKey,
        source: "cep_regional_prefix",
      };
    }
  }

  // 6. Busca por Prefixo / Substring nas chaves do dicionário
  for (const [key, hub] of Object.entries(BRAZILIAN_HUBS)) {
    const hubClean = key.replace(/_[a-z]{2}$/, "");
    if (hubClean.startsWith(normalizedCity) || normalizedCity.startsWith(hubClean)) {
      if (!normalizedUf || hub.uf.toLowerCase() === normalizedUf) {
        const point = applyJitter(hub);
        return {
          lat: point.lat,
          lng: point.lng,
          name: hub.name,
          uf: hub.uf,
          confidence: "fuzzy_match",
          approximate: true,
          matchedKey: key,
          source: "dictionary_substring",
        };
      }
    }
  }

  // 7. Fallback para a Capital do Estado
  if (normalizedUf && CAPITALS_BY_UF.has(normalizedUf)) {
    const capital = CAPITALS_BY_UF.get(normalizedUf)!;
    const point = applyJitter(capital);
    return {
      lat: point.lat,
      lng: point.lng,
      name: `${capital.name} (Fallback Estadual)`,
      uf: capital.uf,
      confidence: "state_capital",
      approximate: true,
      matchedKey: `${capital.name}_${capital.uf}`,
      source: "state_capital_fallback",
    };
  }

  // 8. Fallback Absoluto para o Centro de Distribuição da Empresa
  const depotPoint = applyJitter(DEFAULT_DEPOT);
  return {
    lat: depotPoint.lat,
    lng: depotPoint.lng,
    name: `${DEFAULT_DEPOT.name} (Fallback Geral)`,
    uf: DEFAULT_DEPOT.uf,
    confidence: "default_depot",
    approximate: true,
    matchedKey: "default_depot",
    source: "default_depot_fallback",
  };
}

// ---------------------------------------------------------------------------
// 6. Contratos e Handler para Web Workers & Processamento em Segundo Plano
// ---------------------------------------------------------------------------

export interface GeoWorkerRequestMessage {
  id: string;
  action: "RESOLVE_ONE" | "RESOLVE_BATCH" | "CALC_DISTANCE_MATRIX" | "GET_HUBS";
  payload: any;
}

export interface GeoWorkerResponseMessage<T = any> {
  id: string;
  action: string;
  success: boolean;
  data?: T;
  error?: string;
  durationMs: number;
}

export function handleGeoWorkerMessage(
  event: { data: GeoWorkerRequestMessage },
  postResponse: (response: GeoWorkerResponseMessage) => void
): void {
  const start = Date.now();
  const { id, action, payload } = event.data;

  try {
    switch (action) {
      case "RESOLVE_ONE": {
        const result = resolveLocation(payload);
        postResponse({
          id,
          action,
          success: true,
          data: result,
          durationMs: Date.now() - start,
        });
        break;
      }

      case "RESOLVE_BATCH": {
        const items = Array.isArray(payload?.items) ? payload.items : [];
        const results = items.map((item: any, idx: number) => {
          const resolved = resolveLocation({
            city: item.city,
            uf: item.uf,
            address: item.address,
            lat: item.lat,
            lng: item.lng,
            indexInBatch: idx,
          });
          return {
            id: item.id || String(idx),
            ...resolved,
          };
        });
        postResponse({
          id,
          action,
          success: true,
          data: results,
          durationMs: Date.now() - start,
        });
        break;
      }

      case "CALC_DISTANCE_MATRIX": {
        const points = Array.isArray(payload?.points) ? payload.points : [];
        const matrix = buildDistanceMatrix(points);
        postResponse({
          id,
          action,
          success: true,
          data: matrix,
          durationMs: Date.now() - start,
        });
        break;
      }

      case "GET_HUBS": {
        postResponse({
          id,
          action,
          success: true,
          data: BRAZILIAN_HUBS,
          durationMs: Date.now() - start,
        });
        break;
      }

      default:
        postResponse({
          id,
          action: action || "UNKNOWN",
          success: false,
          error: `Ação desconhecida: ${action}`,
          durationMs: Date.now() - start,
        });
    }
  } catch (err: any) {
    postResponse({
      id,
      action: action || "ERROR",
      success: false,
      error: err?.message || "Erro interno no processamento geográfico",
      durationMs: Date.now() - start,
    });
  }
}

// Test & External Contract Aliases
export function normalizeCityName(str: string): string { return cleanNormalized(str); }
export function calculateHaversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number { return haversineDistanceKm(lat1, lng1, lat2, lng2); }
export function getCityCoordinates(city: string, uf?: string | null): GeoPoint | null {
  if (!city || !city.trim()) return null;
  const res = resolveLocation({ city, uf });
  return res ? { lat: res.lat, lng: res.lng } : null;
}
