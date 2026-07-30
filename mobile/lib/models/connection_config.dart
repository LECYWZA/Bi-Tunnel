import 'dart:convert';

class PortForwardRule {
  final String id;
  bool enabled;
  int listenPort;
  String targetHost;
  int targetPort;
  String? targetClientId;

  PortForwardRule({
    String? id,
    this.enabled = false,
    this.listenPort = 8080,
    this.targetHost = '127.0.0.1',
    this.targetPort = 80,
    this.targetClientId,
  }) : id = id ?? DateTime.now().millisecondsSinceEpoch.toString();

  PortForwardRule copyWith({
    String? id,
    bool? enabled,
    int? listenPort,
    String? targetHost,
    int? targetPort,
    String? targetClientId,
  }) {
    return PortForwardRule(
      id: id ?? this.id,
      enabled: enabled ?? this.enabled,
      listenPort: listenPort ?? this.listenPort,
      targetHost: targetHost ?? this.targetHost,
      targetPort: targetPort ?? this.targetPort,
      targetClientId: targetClientId ?? this.targetClientId,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'enabled': enabled,
        'listenPort': listenPort,
        'targetHost': targetHost,
        'targetPort': targetPort,
        'targetClientId': targetClientId,
      };

  factory PortForwardRule.fromJson(Map<String, dynamic> json) => PortForwardRule(
        id: json['id'] as String?,
        enabled: json['enabled'] as bool? ?? true,
        listenPort: json['listenPort'] as int? ?? 8080,
        targetHost: json['targetHost'] as String? ?? '127.0.0.1',
        targetPort: json['targetPort'] as int? ?? 80,
        targetClientId: json['targetClientId'] as String?,
      );
}

class TunnelServerConfig {
  final String id;
  final String name;
  bool enabled;
  String bindIp;
  int listenPort;
  String password;
  String sni;
  List<PortForwardRule> portForwards;
  bool running;

  TunnelServerConfig({
    String? id,
    this.name = '隧道服务端',
    this.enabled = false,
    this.bindIp = '127.0.0.1',
    this.listenPort = 33891,
    this.password = 'admin',
    this.sni = 'mail.qq.com',
    List<PortForwardRule>? portForwards,
    this.running = false,
  })  : id = id ?? DateTime.now().millisecondsSinceEpoch.toString(),
        portForwards = portForwards ?? [];

  TunnelServerConfig copyWith({
    String? id,
    String? name,
    bool? enabled,
    String? bindIp,
    int? listenPort,
    String? password,
    String? sni,
    List<PortForwardRule>? portForwards,
    bool? running,
  }) {
    return TunnelServerConfig(
      id: id ?? this.id,
      name: name ?? this.name,
      enabled: enabled ?? this.enabled,
      bindIp: bindIp ?? this.bindIp,
      listenPort: listenPort ?? this.listenPort,
      password: password ?? this.password,
      sni: sni ?? this.sni,
      portForwards: portForwards ?? this.portForwards,
      running: running ?? this.running,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'enabled': enabled,
        'bindIp': bindIp,
        'listenPort': listenPort,
        'password': password,
        'sni': sni,
        'portForwards': portForwards.map((p) => p.toJson()).toList(),
      };

  factory TunnelServerConfig.fromJson(Map<String, dynamic> json) => TunnelServerConfig(
        id: json['id'] as String?,
        name: json['name'] as String? ?? '隧道服务端',
        enabled: json['enabled'] as bool? ?? true,
        bindIp: json['bindIp'] as String? ?? '127.0.0.1',
        listenPort: json['listenPort'] as int? ?? 33891,
        password: json['password'] as String? ?? 'admin',
        sni: json['sni'] as String? ?? 'mail.qq.com',
        portForwards: json['portForwards'] != null
            ? (json['portForwards'] as List)
                .map((e) => PortForwardRule.fromJson(e as Map<String, dynamic>))
                .toList()
            : [],
      );
}

class TunnelClientConfig {
  final String id;
  final String name;
  bool enabled;
  String serverHost;
  int serverPort;
  String password;
  String sni;
  String clientId;
  List<PortForwardRule> portForwards;
  bool running;

  TunnelClientConfig({
    String? id,
    this.name = '隧道客户端',
    this.enabled = false,
    this.serverHost = '127.0.0.1',
    this.serverPort = 33891,
    this.password = 'admin',
    this.sni = 'mail.qq.com',
    this.clientId = 'mobile-1',
    List<PortForwardRule>? portForwards,
    this.running = false,
  })  : id = id ?? DateTime.now().millisecondsSinceEpoch.toString(),
        portForwards = portForwards ?? [];

  TunnelClientConfig copyWith({
    String? id,
    String? name,
    bool? enabled,
    String? serverHost,
    int? serverPort,
    String? password,
    String? sni,
    String? clientId,
    List<PortForwardRule>? portForwards,
    bool? running,
  }) {
    return TunnelClientConfig(
      id: id ?? this.id,
      name: name ?? this.name,
      enabled: enabled ?? this.enabled,
      serverHost: serverHost ?? this.serverHost,
      serverPort: serverPort ?? this.serverPort,
      password: password ?? this.password,
      sni: sni ?? this.sni,
      clientId: clientId ?? this.clientId,
      portForwards: portForwards ?? this.portForwards,
      running: running ?? this.running,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'enabled': enabled,
        'serverHost': serverHost,
        'serverPort': serverPort,
        'password': password,
        'sni': sni,
        'clientId': clientId,
        'portForwards': portForwards.map((p) => p.toJson()).toList(),
      };

  factory TunnelClientConfig.fromJson(Map<String, dynamic> json) => TunnelClientConfig(
        id: json['id'] as String?,
        name: json['name'] as String? ?? '隧道客户端',
        enabled: json['enabled'] as bool? ?? true,
        serverHost: json['serverHost'] as String? ?? '127.0.0.1',
        serverPort: json['serverPort'] as int? ?? 33891,
        password: json['password'] as String? ?? 'admin',
        sni: json['sni'] as String? ?? 'mail.qq.com',
        clientId: json['clientId'] as String? ?? 'mobile-1',
        portForwards: json['portForwards'] != null
            ? (json['portForwards'] as List)
                .map((e) => PortForwardRule.fromJson(e as Map<String, dynamic>))
                .toList()
            : [],
      );
}

class ProxyAccount {
  String username;
  String password;
  bool enabled;

  ProxyAccount({
    this.username = '',
    this.password = '',
    this.enabled = false,
  });

  Map<String, dynamic> toJson() => {
        'username': username,
        'password': password,
        'enabled': enabled,
      };

  factory ProxyAccount.fromJson(Map<String, dynamic> json) => ProxyAccount(
        username: json['username'] as String? ?? '',
        password: json['password'] as String? ?? '',
        enabled: (json['enabled'] as bool?) ?? ((json['username'] as String?)?.isNotEmpty ?? false),
      );
}

class ProxyInstance {
  final String id;
  final String name;
  bool enabled;
  String bindIp;
  int listenPort;
  List<ProxyAccount> accounts;
  bool running;

  ProxyInstance({
    String? id,
    this.name = 'SOCKS5 代理',
    this.enabled = false,
    this.bindIp = '127.0.0.1',
    this.listenPort = 1080,
    List<ProxyAccount>? accounts,
    this.running = false,
  })  : id = id ?? DateTime.now().millisecondsSinceEpoch.toString(),
        accounts = accounts ?? [];

  ProxyInstance copyWith({
    String? id,
    String? name,
    bool? enabled,
    String? bindIp,
    int? listenPort,
    List<ProxyAccount>? accounts,
    bool? running,
  }) {
    return ProxyInstance(
      id: id ?? this.id,
      name: name ?? this.name,
      enabled: enabled ?? this.enabled,
      bindIp: bindIp ?? this.bindIp,
      listenPort: listenPort ?? this.listenPort,
      accounts: accounts ?? this.accounts,
      running: running ?? this.running,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'enabled': enabled,
        'bindIp': bindIp,
        'listenPort': listenPort,
        'accounts': accounts.map((a) => a.toJson()).toList(),
      };

  factory ProxyInstance.fromJson(Map<String, dynamic> json) => ProxyInstance(
        id: json['id'] as String?,
        name: json['name'] as String? ?? 'SOCKS5 代理',
        enabled: json['enabled'] as bool? ?? true,
        bindIp: json['bindIp'] as String? ?? '127.0.0.1',
        listenPort: json['listenPort'] as int? ?? 1080,
        accounts: json['accounts'] != null
            ? (json['accounts'] as List)
                .map((e) => ProxyAccount.fromJson(e as Map<String, dynamic>))
                .toList()
            : [],
      );
}

enum MatchType { auto }

enum ProxyAction { forward, direct, reject }

class ProxyRule {
  final String id;
  final String name;
  final MatchType matchType;
  final String matchValue;
  final bool enabled;
  final int order;
  final ProxyAction action;

  const ProxyRule({
    String? id,
    this.name = '',
    this.matchType = MatchType.auto,
    this.matchValue = '',
    this.enabled = false,
    this.order = 0,
    this.action = ProxyAction.forward,
  }) : id = id ?? '';

  ProxyRule copyWith({
    String? id,
    String? name,
    MatchType? matchType,
    String? matchValue,
    bool? enabled,
    int? order,
    ProxyAction? action,
  }) {
    return ProxyRule(
      id: id ?? this.id,
      name: name ?? this.name,
      matchType: matchType ?? this.matchType,
      matchValue: matchValue ?? this.matchValue,
      enabled: enabled ?? this.enabled,
      order: order ?? this.order,
      action: action ?? this.action,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'matchType': matchType.name,
        'matchValue': matchValue,
        'enabled': enabled,
        'order': order,
        'action': action.name,
      };

  factory ProxyRule.fromJson(Map<String, dynamic> json) => ProxyRule(
        id: json['id'] as String?,
        name: json['name'] as String? ?? '',
        matchType: MatchType.values.firstWhere(
          (e) => e.name == json['matchType'],
          orElse: () => MatchType.auto,
        ),
        matchValue: json['matchValue'] as String? ?? '',
        enabled: json['enabled'] as bool? ?? false,
        order: json['order'] as int? ?? 0,
        action: ProxyAction.values.firstWhere(
          (e) => e.name == json['action'],
          orElse: () => ProxyAction.forward,
        ),
      );
}

class AppConfig {
  final List<TunnelServerConfig> servers;
  final List<TunnelClientConfig> clients;
  final List<ProxyInstance> proxies;
  final List<ProxyRule> rules;

  const AppConfig({
    this.servers = const [],
    this.clients = const [],
    this.proxies = const [],
    this.rules = const [],
  });

  AppConfig copyWith({
    List<TunnelServerConfig>? servers,
    List<TunnelClientConfig>? clients,
    List<ProxyInstance>? proxies,
    List<ProxyRule>? rules,
  }) {
    return AppConfig(
      servers: servers ?? this.servers,
      clients: clients ?? this.clients,
      proxies: proxies ?? this.proxies,
      rules: rules ?? this.rules,
    );
  }

  Map<String, dynamic> toJson() => {
        'servers': servers.map((s) => s.toJson()).toList(),
        'clients': clients.map((c) => c.toJson()).toList(),
        'proxies': proxies.map((p) => p.toJson()).toList(),
        'rules': rules.map((r) => r.toJson()).toList(),
      };

  factory AppConfig.fromJson(Map<String, dynamic> json) => AppConfig(
        servers: json['servers'] != null
            ? (json['servers'] as List)
                .map((e) => TunnelServerConfig.fromJson(e as Map<String, dynamic>))
                .toList()
            : [],
        clients: json['clients'] != null
            ? (json['clients'] as List)
                .map((e) => TunnelClientConfig.fromJson(e as Map<String, dynamic>))
                .toList()
            : [],
        proxies: json['proxies'] != null
            ? (json['proxies'] as List)
                .map((e) => ProxyInstance.fromJson(e as Map<String, dynamic>))
                .toList()
            : [],
        rules: json['rules'] != null
            ? (json['rules'] as List)
                .map((e) => ProxyRule.fromJson(e as Map<String, dynamic>))
                .toList()
            : [],
      );

  Map<String, dynamic> toClientMethodChannelMap(TunnelClientConfig client) {
    return {
      'id': client.id,
      'serverHost': client.serverHost,
      'serverPort': client.serverPort,
      'password': client.password,
      'clientId': client.clientId,
      'sni': client.sni,
      'localProxyPort': 1080,
      'portForwards': client.portForwards.map((p) => p.toJson()).toList(),
      'rules': rules.where((r) => r.enabled).map((r) => r.toJson()).toList(),
    };
  }

  Map<String, dynamic> toServerMethodChannelMap(TunnelServerConfig server) {
    return {
      'id': server.id,
      'bindIp': server.bindIp,
      'listenPort': server.listenPort,
      'password': server.password,
      'sni': server.sni,
      'portForwards': server.portForwards.map((p) => p.toJson()).toList(),
    };
  }

  Map<String, dynamic> toProxyMethodChannelMap(ProxyInstance proxy) {
    return {
      'id': proxy.id,
      'bindIp': proxy.bindIp,
      'listenPort': proxy.listenPort,
      'accounts': proxy.accounts.map((a) => a.toJson()).toList(),
    };
  }
}
