import { _ } from 'meteor/underscore';
import { $ } from 'meteor/jquery';
import { Meteor } from 'meteor/meteor';
import { DocHead } from 'meteor/kadira:dochead';
import { Template } from 'meteor/templating';
import { ReactiveVar } from 'meteor/reactive-var';
import { FlowRouter } from 'meteor/kadira:flow-router';
import { dbFoundations } from '/db/dbFoundations';
import { dbLog } from '/db/dbLog';
import { inheritedShowLoadingOnSubscribing } from '../layout/loading';
import { formatShortDateTimeText } from '../utils/helpers';
import { alertDialog } from '../layout/alertDialog';
import { shouldStopSubscribe } from '../utils/idle';
import { investFoundCompany } from '../utils/methods';

const rShowAllTags = new ReactiveVar(false);

inheritedShowLoadingOnSubscribing(Template.foundationDetail);
Template.foundationDetail.onCreated(function() {
  rShowAllTags.set(false);
  this.autorun(() => {
    const foundationId = FlowRouter.getParam('foundationId');
    if (foundationId) {
      const foundationData = dbFoundations.findOne(foundationId);
      if (foundationData) {
        DocHead.setTitle(Meteor.settings.public.websiteName + ' - 「' + foundationData.companyName + '」公司資訊');
      }
    }
  });
  this.autorun(() => {
    if (shouldStopSubscribe()) {
      return false;
    }
    const foundationId = FlowRouter.getParam('foundationId');
    if (foundationId) {
      this.subscribe('foundationDetail', foundationId);
    }
  });
});
Template.foundationDetail.helpers({
  foundationData() {
    const foundationId = FlowRouter.getParam('foundationId');

    return dbFoundations.findOne(foundationId);
  },
  getEditHref(foundationId) {
    return FlowRouter.path('editFoundationPlan', { foundationId });
  },
  showAllTags(tags) {
    if (tags.length <= 4) {
      return true;
    }

    return rShowAllTags.get();
  },
  firstFewTags(tags) {
    return tags.slice(0, 3);
  }
});
Template.foundationDetail.events({
  'click [data-action="changeCompanyName"]'(event) {
    event.preventDefault();
    const foundationId = FlowRouter.getParam('foundationId');
    const companyData = dbFoundations.findOne(foundationId, {
      fields: {
        companyName: 1
      }
    });
    alertDialog.dialog({
      type: 'prompt',
      title: '公司更名',
      message: `請輸入新的公司名稱：`,
      defaultValue: companyData.companyName,
      callback: (companyName) => {
        if (companyName) {
          Meteor.customCall('changeFoundCompanyName', foundationId, companyName);
        }
      }
    });
  },
  'click [data-action="showAllTags"]'(event) {
    event.preventDefault();
    rShowAllTags.set(true);
  },
  'click [data-action="markFoundationIllegal"]'(event) {
    event.preventDefault();
    const foundationId = FlowRouter.getParam('foundationId');
    const companyData = dbFoundations.findOne(foundationId, {
      fields: {
        companyName: 1
      }
    });
    alertDialog.dialog({
      type: 'prompt',
      title: '設定違規標記',
      message: '請輸入違規事由：',
      defaultValue: companyData.illegalReason,
      customSetting: `maxlength="10"`,
      callback: (reason) => {
        if (! reason) {
          return;
        }
        if (reason.length > 10) {
          alertDialog.alert('違規標記事由不可大於十個字！');

          return;
        }

        Meteor.customCall('markFoundationIllegal', foundationId, reason);
      }
    });
  },
  'click [data-action="unmarkFoundationIllegal"]'(event) {
    event.preventDefault();
    const foundationId = FlowRouter.getParam('foundationId');
    alertDialog.confirm({
      message: '是否解除違規標記？',
      callback: (result) => {
        if (result) {
          Meteor.customCall('unmarkFoundationIllegal', foundationId);
        }
      }
    });
  },
  'click [data-action="invest"]'(event) {
    event.preventDefault();
    const foundationId = FlowRouter.getParam('foundationId');
    investFoundCompany(foundationId);
  }
});

// 是否展開面板
const rDisplayPanelList = new ReactiveVar([]);
const getTotalInvest = function(investList) {
  return _.reduce(investList, (totalInvest, investData) => {
    return totalInvest + investData.amount;
  }, 0);
};
const getStockPrice = function(investList) {
  const minReleaseStock = Meteor.settings.public.minReleaseStock;
  const totalInvest = getTotalInvest(investList);
  let stockUnitPrice = 1;
  while (Math.ceil(totalInvest / stockUnitPrice / 2) > minReleaseStock) {
    stockUnitPrice *= 2;
  }
  let totalRelease;
  const mapper = (invest) => {
    return Math.floor(invest.amount / stockUnitPrice);
  };
  const reducer = (sum, stocks) => {
    return sum + stocks;
  };
  do {
    totalRelease = _.reduce(_.map(investList, mapper), reducer, 0);
    if (totalRelease < minReleaseStock) {
      stockUnitPrice /= 2;
    }
  }
  while (totalRelease < minReleaseStock);

  return stockUnitPrice;
};
Template.foundationDetailTable.helpers({
  isDisplayPanel(panelType) {
    return _.contains(rDisplayPanelList.get(), panelType);
  },
  investPplsNumberClass(investNumber) {
    return (investNumber >= Meteor.settings.public.foundationNeedUsers) ? 'text-success' : 'text-danger';
  },
  foundationNeedUsers() {
    return Meteor.settings.public.foundationNeedUsers;
  },
  getTotalInvest(investList) {
    return getTotalInvest(investList);
  },
  getExpireDateText(createdAt) {
    const expireDate = new Date(createdAt.getTime() + Meteor.settings.public.foundExpireTime);

    return formatShortDateTimeText(expireDate);
  },
  getStockPrice(investList) {
    if (investList.length < Meteor.settings.public.foundationNeedUsers) {
      return 0;
    }

    return getStockPrice(investList);
  },
  getStockRelease(investList) {
    if (investList.length < Meteor.settings.public.foundationNeedUsers) {
      return 0;
    }
    const price = getStockPrice(investList);

    return _.reduce(investList, (totalStock, investData) => {
      return totalStock + Math.floor(investData.amount / price);
    }, 0);
  }
});
Template.foundationDetailTable.events({
  'click [data-toggle-panel]'(event) {
    event.preventDefault();
    const $emitter = $(event.currentTarget);
    const panelType = $emitter.attr('data-toggle-panel');
    const displayPanelList = rDisplayPanelList.get();
    if (_.contains(displayPanelList, panelType)) {
      rDisplayPanelList.set(_.without(displayPanelList, panelType));
    }
    else {
      displayPanelList.push(panelType);
      rDisplayPanelList.set(displayPanelList);
    }
  }
});

Template.foundationFounderList.helpers({
  orderedInvestList() {
    const foundationId = FlowRouter.getParam('foundationId');
    const foundation = dbFoundations.findOne(foundationId);

    return _.sortBy(foundation.invest, 'amount').reverse();
  },
  getPercentage(amount) {
    const foundationId = FlowRouter.getParam('foundationId');
    const foundation = dbFoundations.findOne(foundationId);

    return (100 * amount / getTotalInvest(foundation.invest)).toFixed(2);
  }
});

const rIsOnlyShowMine = new ReactiveVar(false);
const rLogOffset = new ReactiveVar(0);
inheritedShowLoadingOnSubscribing(Template.foundationLogList);
Template.foundationLogList.onCreated(function() {
  rLogOffset.set(0);
  this.autorun(() => {
    if (shouldStopSubscribe()) {
      return false;
    }
    const companyId = FlowRouter.getParam('foundationId');
    if (companyId) {
      this.subscribe('companyLog', companyId, rIsOnlyShowMine.get(), rLogOffset.get());
    }
  });
});
Template.foundationLogList.helpers({
  onlyShowMine() {
    return rIsOnlyShowMine.get();
  },
  logList() {
    const companyId = FlowRouter.getParam('foundationId');

    return dbLog.find({ companyId }, {
      sort: {
        createdAt: -1
      },
      limit: 30
    });
  },
  paginationData() {
    return {
      useVariableForTotalCount: 'totalCountOfcompanyLog',
      dataNumberPerPage: 30,
      offset: rLogOffset
    };
  }
});
Template.foundationLogList.events({
  'click button'(event) {
    event.preventDefault();
    rIsOnlyShowMine.set(! rIsOnlyShowMine.get());
  }
});
