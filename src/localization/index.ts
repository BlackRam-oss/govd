import i18next from 'i18next';

type LangCode = 'en' | 'it' | 'de' | 'es' | 'fr' | 'pt' | 'ru' | 'zh' | 'ar' | 'ja' | 'ko';
type Messages = Record<string, Partial<Record<LangCode, string>>>;

const messages: Messages = {
  Language: {
    en: 'english', it: 'italiano', de: 'deutsch', es: 'español',
    fr: 'français', pt: 'português', ru: 'русский', zh: '中文',
    ar: 'العربية', ja: '日本語', ko: '한국어',
  },
  StartMessage: {
    en: 'welcome {{Name}} to govd, an open-source telegram bot for downloading content from various social platforms',
    it: 'benvenuto {{Name}} su govd, un bot telegram open-source per scaricare contenuti da varie piattaforme social',
    de: 'willkommen {{Name}} bei govd, einem Open-Source-Telegram-Bot zum Herunterladen von Inhalten aus verschiedenen sozialen Plattformen',
    es: 'bienvenido {{Name}} a govd, un bot de Telegram de código abierto para descargar contenido de varias plataformas sociales',
    fr: 'bienvenue {{Name}} sur govd, un bot Telegram open-source pour télécharger du contenu de diverses plateformes sociales',
    pt: 'bem-vindo {{Name}} ao govd, um bot de Telegram de código aberto para baixar conteúdo de várias plataformas sociais',
    ru: 'добро пожаловать {{Name}} в govd, телеграм-бот с открытым кодом для загрузки контента с различных социальных платформ',
    zh: '欢迎 {{Name}} 使用 govd，这是一个开源的 Telegram 机器人，用于从各种社交平台下载内容',
    ar: 'مرحباً {{Name}} في govd، بوت تيليجرام مفتوح المصدر لتنزيل المحتوى من منصات التواصل الاجتماعي المختلفة',
    ja: '{{Name}} さん、govd へようこそ。様々なソーシャルプラットフォームからコンテンツをダウンロードするオープンソースの Telegram ボットです',
    ko: '{{Name}} 님, govd에 오신 것을 환영합니다. 다양한 소셜 플랫폼에서 콘텐츠를 다운로드하는 오픈소스 텔레그램 봇입니다',
  },
  AddButton: {
    en: 'add to a group', it: 'aggiungi a un gruppo', de: 'zu einer Gruppe hinzufügen',
    es: 'añadir a un grupo', fr: 'ajouter à un groupe', pt: 'adicionar a um grupo',
    ru: 'добавить в группу', zh: '添加到群组', ar: 'أضف إلى مجموعة',
    ja: 'グループに追加', ko: '그룹에 추가',
  },
  ErrorMessage: {
    en: 'an error occurred, please try again later',
    it: 'si è verificato un errore, riprova più tardi',
    de: 'ein Fehler ist aufgetreten, bitte versuche es später erneut',
    es: 'ocurrió un error, por favor inténtalo más tarde',
    fr: "une erreur s'est produite, veuillez réessayer plus tard",
    pt: 'ocorreu um erro, por favor tente novamente mais tarde',
    ru: 'произошла ошибка, пожалуйста, повторите попытку позже',
    zh: '发生错误，请稍后再试', ar: 'حدث خطأ، يرجى المحاولة مرة أخرى لاحقاً',
    ja: 'エラーが発生しました。後でもう一度お試しください',
    ko: '오류가 발생했습니다. 나중에 다시 시도해 주세요',
  },
  AddedToGroupMessage: {
    en: 'thank you for adding me! use /settings command to configure the bot for this group',
    it: 'grazie per avermi aggiunto! usa il comando /settings per configurare il bot per questo gruppo',
    de: 'danke fürs Hinzufügen! Nutze den /settings-Befehl, um den Bot für diese Gruppe zu konfigurieren',
    es: '¡gracias por añadirme! usa el comando /settings para configurar el bot en este grupo',
    fr: "merci de m'avoir ajouté ! utilise la commande /settings pour configurer le bot dans ce groupe",
    pt: 'obrigado por me adicionar! use o comando /settings para configurar o bot neste grupo',
    ru: 'спасибо за добавление! используйте команду /settings для настройки бота в этой группе',
    zh: '感谢您添加我！请使用 /settings 命令为此群组配置机器人',
    ar: 'شكراً لإضافتي! استخدم أمر /settings لتهيئة البوت لهذه المجموعة',
    ja: '追加していただきありがとうございます！/settings コマンドを使って、このグループのボットを設定してください',
    ko: '추가해 주셔서 감사합니다! /settings 명령어를 사용하여 이 그룹의 봇을 설정하세요',
  },
  SettingsButton: {
    en: 'settings', it: 'impostazioni', de: 'einstellungen', es: 'ajustes',
    fr: 'paramètres', pt: 'configurações', ru: 'настройки', zh: '设置',
    ar: 'الإعدادات', ja: '設定', ko: '설정',
  },
  LanguageButton: {
    en: 'language', it: 'lingua', de: 'sprache', es: 'idioma',
    fr: 'langue', pt: 'idioma', ru: 'язык', zh: '语言',
    ar: 'اللغة', ja: '言語', ko: '언어',
  },
  PrivateSettingsMessage: {
    en: 'use the buttons below to change your personal bot settings',
    it: 'usa i pulsanti qui sotto per modificare le tue impostazioni personali del bot',
    de: 'nutze die Schaltflächen unten, um deine persönlichen Bot-Einstellungen zu ändern',
    es: 'usa los botones de abajo para cambiar tu configuración personal del bot',
    fr: 'utilise les boutons ci-dessous pour modifier tes paramètres personnels du bot',
    pt: 'use os botões abaixo para alterar suas configurações pessoais do bot',
    ru: 'используйте кнопки ниже, чтобы изменить личные настройки бота',
    zh: '使用下方按钮更改您的个人机器人设置', ar: 'استخدم الأزرار أدناه لتغيير إعداداتك الشخصية للبوت',
    ja: '以下のボタンを使って個人のボット設定を変更してください',
    ko: '아래 버튼을 사용하여 개인 봇 설정을 변경하세요',
  },
  GroupSettingsMessage: {
    en: "use the buttons below to change this group's bot settings",
    it: 'usa i pulsanti qui sotto per modificare le impostazioni del bot per questo gruppo',
    de: 'nutze die Schaltflächen unten, um die Bot-Einstellungen für diese Gruppe zu ändern',
    es: 'usa los botones de abajo para cambiar la configuración del bot en este grupo',
    fr: 'utilise les boutons ci-dessous pour modifier les paramètres du bot pour ce groupe',
    pt: 'use os botões abaixo para alterar as configurações do bot neste grupo',
    ru: 'используйте кнопки ниже, чтобы изменить настройки бота для этой группы',
    zh: '使用下方按钮更改此群组的机器人设置', ar: 'استخدم الأزرار أدناه لتغيير إعدادات البوت لهذه المجموعة',
    ja: '以下のボタンを使ってこのグループのボット設定を変更してください',
    ko: '아래 버튼을 사용하여 이 그룹의 봇 설정을 변경하세요',
  },
  BackButton: {
    en: 'back', it: 'indietro', de: 'zurück', es: 'atrás', fr: 'retour',
    pt: 'voltar', ru: 'назад', zh: '返回', ar: 'رجوع', ja: '戻る', ko: '뒤로',
  },
  SelectLanguageMessage: {
    en: 'select your preferred language', it: 'seleziona la tua lingua preferita',
    de: 'wähle deine bevorzugte Sprache', es: 'selecciona tu idioma preferido',
    fr: 'sélectionne ta langue préférée', pt: 'selecione seu idioma preferido',
    ru: 'выберите предпочитаемый язык', zh: '选择您偏好的语言',
    ar: 'اختر لغتك المفضلة', ja: 'お好みの言語を選択してください',
    ko: '선호하는 언어를 선택하세요',
  },
  CaptionsSettingsMessage: {
    en: 'when enabled, adds original description to downloaded content, if available',
    it: 'se abilitato, aggiunge la descrizione originale ai contenuti scaricati, se disponibile',
    de: 'wenn aktiviert, wird die Originalbeschreibung zu heruntergeladenen Inhalten hinzugefügt, sofern verfügbar',
    es: 'cuando está habilitado, añade la descripción original al contenido descargado, si está disponible',
    fr: "si activé, ajoute la description originale au contenu téléchargé, si disponible",
    pt: 'quando ativado, adiciona a descrição original ao conteúdo baixado, se disponível',
    ru: 'если включено, добавляет оригинальное описание к загруженному контенту, если доступно',
    zh: '启用后，如果可用，将在下载的内容中添加原始描述',
    ar: 'عند التفعيل، يضيف الوصف الأصلي للمحتوى المنزّل، إذا كان متاحاً',
    ja: '有効にすると、ダウンロードしたコンテンツに元の説明が追加されます（利用可能な場合）',
    ko: '활성화하면 다운로드한 콘텐츠에 원본 설명이 추가됩니다(사용 가능한 경우)',
  },
  NsfwSettingsMessage: {
    en: 'when enabled, allows downloading nsfw content in this chat',
    it: 'se abilitato, consente il download di contenuti nsfw in questa chat',
    de: 'wenn aktiviert, erlaubt das Herunterladen von NSFW-Inhalten in diesem Chat',
    es: 'cuando está habilitado, permite descargar contenido nsfw en este chat',
    fr: 'si activé, permet de télécharger du contenu nsfw dans ce chat',
    pt: 'quando ativado, permite baixar conteúdo nsfw neste chat',
    ru: 'если включено, разрешает загрузку nsfw-контента в этом чате',
    zh: '启用后，允许在此聊天中下载 nsfw 内容',
    ar: 'عند التفعيل، يسمح بتنزيل المحتوى الإباحي في هذه المحادثة',
    ja: '有効にすると、このチャットで NSFW コンテンツのダウンロードが許可されます',
    ko: '활성화하면 이 채팅에서 nsfw 콘텐츠 다운로드가 허용됩니다',
  },
  SilentModeSettingsMessage: {
    en: 'when enabled, the bot will not send error messages',
    it: 'se abilitato, il bot non invierà messaggi di errore',
    de: 'wenn aktiviert, sendet der Bot keine Fehlermeldungen',
    es: 'cuando está habilitado, el bot no enviará mensajes de error',
    fr: "si activé, le bot n'enverra pas de messages d'erreur",
    pt: 'quando ativado, o bot não enviará mensagens de erro',
    ru: 'если включено, бот не будет отправлять сообщения об ошибках',
    zh: '启用后，机器人将不发送错误消息', ar: 'عند التفعيل، لن يرسل البوت رسائل الخطأ',
    ja: '有効にすると、ボットはエラーメッセージを送信しません',
    ko: '활성화하면 봇이 오류 메시지를 보내지 않습니다',
  },
  MediaAlbumSettingsMessage: {
    en: 'select maximum number of files allowed in a single media album',
    it: 'seleziona il numero massimo di file consentiti in un singolo album multimediale',
    de: 'wähle die maximale Anzahl von Dateien in einem einzelnen Medienalbum',
    es: 'selecciona el número máximo de archivos permitidos en un álbum multimedia',
    fr: "sélectionne le nombre maximum de fichiers autorisés dans un seul album multimédia",
    pt: 'selecione o número máximo de arquivos permitidos em um único álbum de mídia',
    ru: 'выберите максимальное количество файлов в одном медиаальбоме',
    zh: '选择单个媒体相册中允许的最大文件数',
    ar: 'اختر الحد الأقصى لعدد الملفات المسموح بها في ألبوم وسائط واحد',
    ja: '1つのメディアアルバムで許可されるファイルの最大数を選択してください',
    ko: '단일 미디어 앨범에 허용되는 최대 파일 수를 선택하세요',
  },
  InlineLoadingMessage: {
    en: 'loading... please wait', it: 'caricamento... attendere',
    de: 'wird geladen... bitte warten', es: 'cargando... por favor espera',
    fr: 'chargement... veuillez patienter', pt: 'carregando... por favor aguarde',
    ru: 'загрузка... пожалуйста, подождите', zh: '加载中... 请稍候',
    ar: 'جارٍ التحميل... يرجى الانتظار', ja: '読み込み中... お待ちください',
    ko: '로딩 중... 잠시 기다려 주세요',
  },
  InlineShareMessage: {
    en: 'share this media', it: 'condividi questo media', de: 'dieses Medium teilen',
    es: 'compartir este contenido', fr: 'partager ce média', pt: 'compartilhar esta mídia',
    ru: 'поделиться этим медиа', zh: '分享此媒体', ar: 'مشاركة هذه الوسائط',
    ja: 'このメディアを共有', ko: '이 미디어 공유',
  },
  NoPermission: {
    en: "you don't have permissions to perform this action",
    it: 'non hai i permessi per eseguire questa azione',
    de: 'du hast keine Berechtigung, diese Aktion durchzuführen',
    es: 'no tienes permisos para realizar esta acción',
    fr: "tu n'as pas les permissions pour effectuer cette action",
    pt: 'você não tem permissões para realizar esta ação',
    ru: 'у вас нет прав для выполнения этого действия',
    zh: '您没有权限执行此操作', ar: 'ليس لديك صلاحيات لتنفيذ هذا الإجراء',
    ja: 'このアクションを実行する権限がありません',
    ko: '이 작업을 수행할 권한이 없습니다',
  },
  CloseButton: {
    en: 'close', it: 'chiudi', de: 'schließen', es: 'cerrar', fr: 'fermer',
    pt: 'fechar', ru: 'закрыть', zh: '关闭', ar: 'إغلاق', ja: '閉じる', ko: '닫기',
  },
  MediaAlbumButton: {
    en: 'media album', it: 'album multimediale', de: 'medienalbum', es: 'álbum multimedia',
    fr: 'album multimédia', pt: 'álbum de mídia', ru: 'медиаальбом', zh: '媒体相册',
    ar: 'ألبوم الوسائط', ja: 'メディアアルバム', ko: '미디어 앨범',
  },
  SilentModeButton: {
    en: 'silent mode', it: 'modalità silenziosa', de: 'stummschaltung', es: 'modo silencioso',
    fr: 'mode silencieux', pt: 'modo silencioso', ru: 'тихий режим', zh: '静音模式',
    ar: 'الوضع الصامت', ja: 'サイレントモード', ko: '무음 모드',
  },
  CaptionsButton: {
    en: 'captions', it: 'didascalie', de: 'untertitel', es: 'subtítulos',
    fr: 'légendes', pt: 'legendas', ru: 'подписи', zh: '字幕',
    ar: 'التعليقات', ja: 'キャプション', ko: '자막',
  },
  NsfwButton: {
    en: 'nsfw', it: 'nsfw', de: 'nsfw', es: 'nsfw', fr: 'nsfw',
    pt: 'nsfw', ru: 'nsfw', zh: 'nsfw', ar: 'nsfw', ja: 'nsfw', ko: 'nsfw',
  },
  ExtractorsButton: {
    en: 'extractors', it: 'estrattori', de: 'extraktoren', es: 'extractores',
    fr: 'extracteurs', pt: 'extratores', ru: 'экстракторы', zh: '提取器',
    ar: 'المستخلصات', ja: 'エクストラクター', ko: '추출기',
  },
  DisabledExtractorsSettingsMessage: {
    en: 'select which extractors should be disabled',
    it: 'seleziona quali estrattori disabilitare',
    de: 'wähle, welche Extraktoren deaktiviert werden sollen',
    es: 'selecciona qué extractores deben deshabilitarse',
    fr: 'sélectionne quels extracteurs doivent être désactivés',
    pt: 'selecione quais extratores devem ser desativados',
    ru: 'выберите, какие экстракторы следует отключить',
    zh: '选择应禁用哪些提取器', ar: 'اختر المستخلصات التي يجب تعطيلها',
    ja: '無効にするエクストラクターを選択してください',
    ko: '비활성화할 추출기를 선택하세요',
  },
  DeleteLinksButton: {
    en: 'links', it: 'link', de: 'links', es: 'enlaces', fr: 'liens',
    pt: 'links', ru: 'ссылки', zh: '链接', ar: 'الروابط', ja: 'リンク', ko: '링크',
  },
  DeleteLinksSettingsMessage: {
    en: 'when enabled, deletes the original message after processing the link',
    it: 'se abilitato, elimina il messaggio originale dopo aver elaborato il link',
    de: 'wenn aktiviert, löscht die ursprüngliche Nachricht nach der Verarbeitung des Links',
    es: 'cuando está habilitado, elimina el mensaje original después de procesar el enlace',
    fr: 'si activé, supprime le message original après traitement du lien',
    pt: 'quando ativado, exclui a mensagem original após processar o link',
    ru: 'если включено, удаляет исходное сообщение после обработки ссылки',
    zh: '启用后，处理链接后删除原始消息', ar: 'عند التفعيل، يحذف الرسالة الأصلية بعد معالجة الرابط',
    ja: '有効にすると、リンク処理後に元のメッセージが削除されます',
    ko: '활성화하면 링크 처리 후 원본 메시지가 삭제됩니다',
  },
  SupportedExtractorsMessage: {
    en: 'list of supported extractors by the bot',
    it: 'lista degli estrattori supportati dal bot',
    de: 'liste der vom Bot unterstützten Extraktoren',
    es: 'lista de extractores compatibles con el bot',
    fr: 'liste des extracteurs pris en charge par le bot',
    pt: 'lista de extratores suportados pelo bot',
    ru: 'список экстракторов, поддерживаемых ботом',
    zh: '机器人支持的提取器列表', ar: 'قائمة المستخلصات المدعومة من البوت',
    ja: 'ボットがサポートするエクストラクターの一覧',
    ko: '봇이 지원하는 추출기 목록',
  },
  EnabledButton: {
    en: 'enabled', it: 'abilitato', de: 'aktiviert', es: 'habilitado',
    fr: 'activé', pt: 'ativado', ru: 'включено', zh: '已启用',
    ar: 'مفعّل', ja: '有効', ko: '활성화됨',
  },
  DisabledButton: {
    en: 'disabled', it: 'disabilitato', de: 'deaktiviert', es: 'deshabilitado',
    fr: 'désactivé', pt: 'desativado', ru: 'отключено', zh: '已禁用',
    ar: 'معطّل', ja: '無効', ko: '비활성화됨',
  },
};

function buildResources(msgs: Messages): Record<string, { translation: Record<string, string> }> {
  const resources: Record<string, { translation: Record<string, string> }> = {};
  for (const [key, translations] of Object.entries(msgs)) {
    for (const [lang, value] of Object.entries(translations)) {
      if (!value) continue;
      if (!resources[lang]) resources[lang] = { translation: {} };
      resources[lang].translation[key] = value;
    }
  }
  return resources;
}

const i18n = i18next.createInstance();
i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: buildResources(messages),
  interpolation: { escapeValue: false },
});

export function t(messageId: string, lang: string = 'en', data: Record<string, string> = {}): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return String((i18n.t as any)(messageId, { lng: lang, ...data }));
}

export function localizer(lang: string = 'en'): { t: (messageId: string, data?: Record<string, string>) => string } {
  return {
    t: (messageId: string, data: Record<string, string> = {}) => t(messageId, lang, data),
  };
}
