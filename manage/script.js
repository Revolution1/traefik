var myApp = angular.module('myApp', []);

myApp.filter('toDomain', function () {
  var filter = function (labels) {
    return labels['interlock.hostname'] + '.' + labels['interlock.domain'];
  };
  return filter;
});

myApp.controller('mainCtrl', function ($scope, $http) {
  window.mainScope = $scope;
  window.myApp = myApp;

  $scope.servDetail = null;
  $scope.alerts = [];
  $scope.authenticated = true;
  $scope.auth = {
    username: '',
    password: ''
  };

  function parseBaseUrl(url) {
    if (!url)
      return '';
    if (url.indexOf('http://') == -1 && url.indexOf('https://') == -1)
      url = 'http://' + url;
    if (url.lastIndexOf('/') + 1 == url.length)
      url = url.slice(0, -1);
    return url;
  }

  function testUrl(url) {
    if (!url)
      return false;
    var ret = false;
    jQuery.ajax({
        url: url + '/api',
        async: false,
        timout: 1500
      })
      .done(function () {
        ret = true;
      })
      .fail(function () {
        ret = false;
      });
    return ret;
  }

  $scope.baseurl = parseBaseUrl(DCE_CONTROLLER_URL);

  // auto detect baseurl
  var _lsUrl = parseBaseUrl(localStorage.baseurl);
  var _localUrl = parseBaseUrl(location.hostname);
  var _refUrl = parseBaseUrl(document.referrer);
  if (testUrl(_lsUrl))
    $scope.baseurl = _lsUrl;
  else if (testUrl(_localUrl))
    $scope.baseurl = _localUrl;
  else if (testUrl(_refUrl))
    $scope.baseurl = _refUrl;
  if ($scope.baseurl.split(':').length > 2)
    $scope.baseAddr = $scope.baseurl.slice(0, $scope.baseurl.lastIndexOf(':'));
  else $scope.baseAddr = $scope.baseurl;

  if (!!localStorage.username)
    $scope.auth.username = localStorage.username;

  if (!!localStorage.password)
    $scope.auth.password = localStorage.password;

  $scope.loginModal = function (opt) {
    $('#login-modal').modal(opt);
  };

  function getAuthHeader() {
    return {
      headers: {
        'Authorization': 'Basic ' + btoa($scope.auth.username + ':' + $scope.auth.password)
      }
    };
  }

  $scope.modalOnSave = function (baseurl, auth) {
    $scope.baseurl = parseBaseUrl(baseurl);
    if ($scope.baseurl.split(':').length > 2)
      $scope.baseAddr = $scope.baseurl.slice(0, $scope.baseurl.lastIndexOf(':'));
    else $scope.baseAddr = $scope.baseurl;
    $scope.auth = auth;
    $scope.fetchApps();
  };

  $scope.modalKeyDown = function ($event) {
    if ($event.key == 'Enter')
      $scope.modalOnSave($scope.baseurl, $scope.auth);
  };

  function newAlert(text, level) {
    var alert = {
      id: new Date().valueOf(),
      text: text,
      level: level
    };
    $scope.alerts.push(alert);
    setTimeout(function () {
      jQuery('#alert-' + alert.id).click();
      $scope.alerts.pop();
    }, 5000);
  }

  $scope.setExposedPorts = function (service) {
    image = service.Spec.TaskTemplate.ContainerSpec.Image;
    $http.get($scope.baseurl + '/images/' + image + '/json', getAuthHeader()).then(function (res) {
      service.exposedPorts = _.keys(res.data.ContainerConfig.ExposedPorts);
    });
  };

  $scope.fetchApps = function () {
    $http.get($scope.baseurl + '/api/apps', getAuthHeader()).then(function (res) {
      localStorage.username = $scope.auth.username;
      localStorage.password = $scope.auth.password;
      localStorage.baseurl = $scope.baseurl;
      $scope.authenticated = true;
      $scope.loginModal('hide');

      var apps = res.data.filter(function (app) {
        var s = app.Services.filter(function (s) {
          return s.Spec.Labels && s.Spec.Labels['io.daocloud.dce.traefik'] === 'traefik';
        });
        if (_.isEmpty(s))
          return true;
        $scope.traefik = s[0];
        $scope.traefik.netId = $scope.traefik.Spec.Networks[0].Target;
        $http.get($scope.baseurl + '/networks/' + $scope.traefik.netId, getAuthHeader()).then(function (res) {
          $scope.traefik.netName = res.data.Name;
        });
        $scope.traefik.lbPort = $scope.traefik.Endpoint.Ports.filter(function (p) {
          return p.TargetPort === 80;
        })[0].PublishedPort;
        $scope.traefik.uiPort = $scope.traefik.Endpoint.Ports.filter(function (p) {
          return p.TargetPort === 8080;
        })[0].PublishedPort;
        $scope.traefik.uiUrl = $scope.baseAddr + ':' + $scope.traefik.uiPort;
        $scope.traefik.domain = $scope.traefik.Spec.TaskTemplate.ContainerSpec.Args.filter(function (a) {
          return a.startsWith('--docker.domain');
        })[0].split('=')[1];
        return false;
      });

      $scope.isInTraefikNet = function (s) {
        if (s.Spec.Networks)
          return !_.isEmpty(s.Spec.Networks.filter(function (n) {
            return n.Target === $scope.traefik.netId;
          }));
        return false;
      };
      $scope.traefikEnabled = function (s) {
        var rules = [$scope.isInTraefikNet(s)];
        if (s.Spec.Labels) {
          rules.push(s.Spec.Labels["traefik.enable"] !== "false" || s.Spec.Labels["traefik.enable"] === "true");
          rules.push(s.Spec.Labels["traefik.port"]);
        }

        return _.every(rules);
      };

      $scope.serviceHost = function (s) {
        rule = s.Spec.Labels['traefik.frontend.rule'];
        if (rule)
          if (rule.startsWith('Host:'))
            return rule.slice(5);
          else {
            s.notSupport = true;
            return newAlert('警告：服务' + s.Spec.Name + '已配置规则 label： “traefik.frontend.rule” 且本编辑器目前无法处理这种规则',
              'alert-warning');
          }
        return s.Spec.Name + '.' + $scope.traefik.domain;
      };

      apps.forEach(function (app) {
        app.Services.forEach(function (s) {
          s.traefikEnabled = $scope.traefikEnabled(s);
          s.traefikHost = $scope.serviceHost(s);
          s.traefikPort = s.Spec.Labels['traefik.port'];
          s.lbPort = $scope.traefik.lbPort;
          s.inTraefikNet = $scope.isInTraefikNet(s);
          $scope.setExposedPorts(s);
        });
      });
      $scope.apps = apps;
      if (apps.length == res.data.length)
        newAlert('警告：未检测到 traefik 服务，请前往应用模板中心部署',
          'alert-warning');
      return res;
    }).catch(function (err) {
      $scope.authenticated = false;
      $scope.loginModal('show');
    });
  };

  $scope.fetchApps();

  $scope.showServiceDetail = function showServiceDetail(serv, app) {
    $scope.servDetail = _.clone(serv);
    $scope.servDetail.appName = app.Name;
    setTimeout(function () {
      jQuery('.help-icon img').tooltip({
        container: 'body'
      });
    }, 2);
  };


  $scope.updateService = function (servDetail) {
    var spec = servDetail.Spec;

    var port = _.parseInt(servDetail.traefikPort);
    if (!servDetail.traefikPort)
      return newAlert('端口不可为空', 'alert-danger');
    else if (!(_.isInteger(port) && (port < 65536) && (port > 0)))
      return newAlert(servDetail.traefikPort + ' 不是一个有效的端口', 'alert-danger');

    //currently modify network of service is not supported
    // var _nets = spec.Networks.filter(function (n) {
    //   return n.Target !== $scope.traefik.netId;
    // });
    // if ($scope.traefikEnabled(servDetail) !== servDetail.traefikEnabled) {
    //   if (servDetail.traefikEnabled)
    //     _nets.push({
    //       Target: $scope.traefik.netId
    //     });
    //   spec.Networks = _nets;
    // }

    //ensure labels
    spec.Labels["traefik.enable"] = servDetail.traefikEnabled ? 'true' : 'false';
    if ($scope.serviceHost(servDetail) !== servDetail.traefikHost) // not default host
      spec.Labels['traefik.frontend.rule'] = 'Host:' + servDetail.traefikHost;
    spec.Labels["traefik.port"] = servDetail.traefikPort;
    if (servDetail.traefikEnabled)
      spec.Labels['io.daocloud.dce.url.TraefikHost'] = 'http://' + servDetail.traefikHost;
    else delete spec.Labels['io.daocloud.dce.url.TraefikHost'];

    $http.get($scope.baseurl + '/services/' + servDetail.ID, getAuthHeader())
      .then(function (res) {
        var version = res.data.Version.Index;
        // if (!servOrigin.Endpoint.Ports)
        //   newAlert('服务没有导出端口，域名设置不会生效', 'alert-warning');
        return $http.post($scope.baseurl + '/services/' + servDetail.ID + '/update?version=' + version, spec, getAuthHeader());
      })
      .then(function (res) {
        newAlert('更新成功', 'alert-success');
        $scope.fetchApps();
      })
      .catch(function (err) {
        newAlert('更新失败', 'alert-danger');
      });
  };
});
