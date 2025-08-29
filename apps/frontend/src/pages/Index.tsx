import { Button } from "@/components/ui/button";

const Index = () => {
  return (
    <div className="min-h-screen bg-gradient-subtle relative overflow-hidden">
      {/* Ambient glow effect */}
      <div className="absolute inset-0 bg-gradient-glow opacity-50" />
      
      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4">
        <div className="text-center space-y-8 max-w-4xl mx-auto">
          {/* Main heading */}
          <div className="space-y-4">
            <h1 className="text-6xl md:text-7xl font-bold bg-gradient-primary bg-clip-text text-transparent leading-tight">
              Ваш проект
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Красивая основа для создания чего-то удивительного
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Button 
              variant="default" 
              size="lg"
              className="bg-gradient-primary hover:shadow-elegant transition-all duration-300 transform hover:scale-105"
            >
              Начать создавать
            </Button>
            <Button 
              variant="outline" 
              size="lg"
              className="border-primary/20 hover:bg-primary/5 transition-all duration-300"
            >
              Узнать больше
            </Button>
          </div>

          {/* Decorative cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16 max-w-4xl">
            <div className="bg-card/50 backdrop-blur-sm rounded-lg border border-border/50 p-6 shadow-soft hover:shadow-elegant transition-all duration-300 hover:transform hover:scale-105">
              <div className="w-12 h-12 bg-gradient-primary rounded-lg mb-4 flex items-center justify-center">
                <div className="w-6 h-6 bg-primary-foreground rounded opacity-80" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Готово к работе</h3>
              <p className="text-muted-foreground text-sm">
                Современная система дизайна и компоненты уже настроены
              </p>
            </div>

            <div className="bg-card/50 backdrop-blur-sm rounded-lg border border-border/50 p-6 shadow-soft hover:shadow-elegant transition-all duration-300 hover:transform hover:scale-105">
              <div className="w-12 h-12 bg-gradient-primary rounded-lg mb-4 flex items-center justify-center">
                <div className="w-6 h-6 bg-primary-foreground rounded opacity-80" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Красивый дизайн</h3>
              <p className="text-muted-foreground text-sm">
                Элегантные градиенты, тени и анимации из коробки
              </p>
            </div>

            <div className="bg-card/50 backdrop-blur-sm rounded-lg border border-border/50 p-6 shadow-soft hover:shadow-elegant transition-all duration-300 hover:transform hover:scale-105">
              <div className="w-12 h-12 bg-gradient-primary rounded-lg mb-4 flex items-center justify-center">
                <div className="w-6 h-6 bg-primary-foreground rounded opacity-80" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Расширяемый</h3>
              <p className="text-muted-foreground text-sm">
                Легко добавлять новые компоненты и страницы
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;