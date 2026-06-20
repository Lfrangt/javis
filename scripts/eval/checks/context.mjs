import { ok, fail } from '../_client.mjs';

function needs(plan = {}) {
  return plan.needs || {};
}

export default {
  lane: 'context',
  async run(ctx) {
    const out = [];

    const status = await ctx.api('/api/context/plan', {
      method: 'POST',
      body: { message: '现在状态怎么样？', useMemory: false },
    });
    const statusPlan = status.data?.contextPlan;
    const statusNeeds = needs(statusPlan);
    out.push(
      status.ok && statusPlan && statusNeeds.residentState === true && !statusNeeds.screen && !statusNeeds.browserPage && !statusNeeds.files
        ? ok('context.status', 'Status context plan', `${statusPlan.mode}: skips heavy context`, statusPlan)
        : fail('context.status', 'Status context plan', `expected resident-only plan, got ${status.status}`, status.data),
    );

    const browser = await ctx.api('/api/context/plan', {
      method: 'POST',
      body: { message: '总结当前网页并提取关键链接', useMemory: false },
    });
    const browserPlan = browser.data?.contextPlan;
    const browserNeeds = needs(browserPlan);
    out.push(
      browser.ok && browserNeeds.browserContext === true && browserNeeds.browserPage === true && !browserNeeds.screen && !browserNeeds.files
        ? ok('context.browser', 'Browser context plan', `${browserPlan.mode}: ${browserPlan.recommendedTools?.join(', ')}`, browserPlan)
        : fail('context.browser', 'Browser context plan', `expected browser page plan, got ${browser.status}`, browser.data),
    );

    const knowledge = await ctx.api('/api/context/plan', {
      method: 'POST',
      body: { message: '查笔记 JAVIS Agent Loop', useMemory: false },
    });
    const knowledgePlan = knowledge.data?.contextPlan;
    const knowledgeNeeds = needs(knowledgePlan);
    const knowledgeTools = knowledgePlan?.recommendedTools || [];
    out.push(
      knowledge.ok &&
        knowledgePlan?.mode === 'knowledge' &&
        knowledgeNeeds.knowledge === true &&
        knowledgeNeeds.files === true &&
        knowledgeTools.includes('get_knowledge_vaults') &&
        knowledgeTools.includes('search_knowledge_notes') &&
        knowledgeTools.includes('run_knowledge_workflow')
        ? ok('context.knowledge', 'Knowledge context plan', `${knowledgePlan.mode}: ${knowledgeTools.join(', ')}`, knowledgePlan)
        : fail('context.knowledge', 'Knowledge context plan', `expected knowledge vault plan, got ${knowledge.status}`, knowledge.data),
    );

    const browserActivity = await ctx.api('/api/context/plan', {
      method: 'POST',
      body: { message: '我刚才在浏览器看了什么？', useMemory: false },
    });
    const browserActivityPlan = browserActivity.data?.contextPlan;
    const browserActivityNeeds = needs(browserActivityPlan);
    out.push(
      browserActivity.ok &&
        browserActivityNeeds.browserActivity === true &&
        browserActivityNeeds.browserPage !== true &&
        browserActivityPlan?.recommendedTools?.includes('get_browser_activity')
        ? ok('context.browser_activity', 'Browser activity context plan', `${browserActivityPlan.mode}: ${browserActivityPlan.recommendedTools?.join(', ')}`, browserActivityPlan)
        : fail('context.browser_activity', 'Browser activity context plan', `expected metadata-only browser activity plan, got ${browserActivity.status}`, browserActivity.data),
    );

    const perception = await ctx.api('/api/context/plan', {
      method: 'POST',
      body: { message: '你现在能看到什么、能操作什么、哪些权限开着？', useMemory: false },
    });
    const perceptionPlan = perception.data?.contextPlan;
    const perceptionNeeds = needs(perceptionPlan);
    out.push(
      perception.ok &&
        perceptionNeeds.perceptionStatus === true &&
        perceptionNeeds.residentState === true &&
        perceptionNeeds.screen !== true &&
        perceptionNeeds.browserPage !== true &&
        perceptionNeeds.files !== true &&
        perceptionPlan?.recommendedTools?.includes('get_perception_consent')
        ? ok('context.perception_consent', 'Perception consent context plan', `${perceptionPlan.mode}: ${perceptionPlan.recommendedTools?.join(', ')}`, perceptionPlan)
        : fail('context.perception_consent', 'Perception consent context plan', `expected lightweight perception consent plan, got ${perception.status}`, perception.data),
    );

    const app = await ctx.api('/api/context/plan', {
      method: 'POST',
      body: { message: '点击当前应用里的搜索框并输入 JAVIS', useMemory: false },
    });
    const appPlan = app.data?.contextPlan;
    const appNeeds = needs(appPlan);
    out.push(
      app.ok && appNeeds.accessibility === true && appNeeds.localExecution === true && appPlan.observeOptions?.includeAccessibility === true
        ? ok('context.app', 'App control context plan', `${appPlan.mode}: AX ${appPlan.observeOptions.maxNodes}/${appPlan.observeOptions.maxDepth}`, appPlan)
        : fail('context.app', 'App control context plan', `expected app/AX plan, got ${app.status}`, app.data),
    );

    const route = await ctx.api('/api/tasks/route', {
      method: 'POST',
      body: { message: '总结当前网页并提取关键链接', execute: false, useMemory: false, source: 'eval' },
    });
    const routePlan = route.data?.contextPlan;
    const routingPlan = route.data?.routing?.contextPlan;
    out.push(
      route.ok && routePlan?.needs?.browserPage === true && routingPlan?.needs?.browserPage === true
        ? ok('context.routing', 'Routing context evidence', `${routePlan.mode} stored on route ${route.data.routing?.id || ''}`, { contextPlan: routePlan, routingPlan })
        : fail('context.routing', 'Routing context evidence', `route did not persist context plan (${route.status})`, route.data),
    );

    return out;
  },
};
